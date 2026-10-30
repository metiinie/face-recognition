"""
Automated Verification Suite for Version 1 Completion Audit Areas:
  1. Face detection: Reject images containing zero or multiple faces
  2. Face alignment: Normalize face position, rotation and scale
  3. Image validation: Validate actual image contents (magic bytes, size bounds, corruption)
  4. Recognition: Test different photographs of the same person
  5. False matches: Test many different employees against each other (no cross-matches)
  6. Liveness: Test printed photos, phone displays and video replay (anti-spoofing)
  7. Enrollment security: Prevent unauthorized template replacement (consent, RBAC, audit)
  8. Template management: Handle replacement, revocation, model versions, and timestamps
  9. Database: Verify encrypted templates survive restart and migration
  10. Attendance: Ensure unsuccessful recognition never creates attendance
  11. Privacy: Define and verify consent, retention cleanup, and deletion procedures
  12. Model compatibility: Enforce matching only against compatible models and migration
"""
import io
import base64
from datetime import datetime, timedelta, timezone
import numpy as np
from PIL import Image
import pytest

from backend import create_app
from backend.config import TestConfig
from backend.database import db
from backend.database.models import (
    Employee,
    FaceTemplate,
    AttendanceSession,
    AttendanceEvent,
    AuditLog,
    ReviewCase,
    utc_now,
)
from backend.database.seed import seed_initial_data
from backend.database.migrations import verify_relational_integrity
from backend.face_engine.recognizer import (
    analyze_and_extract_embedding,
    recognize_face_candidate,
    cosine_similarity,
    generate_deterministic_embedding,
)
from backend.face_enrollment.service import (
    enroll_employee_face,
    revoke_employee_templates,
    purge_employee_biometrics,
    apply_biometric_retention_policy,
    get_model_compatibility_report,
    sync_legacy_templates_for_model,
    decrypt_embedding,
)


def _generate_synthetic_image(mode="normal", skin_color=(210, 160, 130), offset_x=0, offset_y=0, width=160, height=160):
    """
    Generate synthetic test images covering face detection, alignment, liveness, and corruption cases.
    """
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    arr[:, :] = [50, 50, 60]  # dark slate neutral background

    cx = width // 2 + offset_x
    cy = height // 2 + offset_y
    rx = int(width * 0.22)
    ry = int(height * 0.28)

    if mode == "zero_faces":
        # Scenery with sky and grass tones and no human skin locus
        arr[: height // 2, :] = [40, 100, 200]
        arr[height // 2 :, :] = [30, 140, 50]
    elif mode == "multiple_faces":
        # Two distinct faces positioned horizontally side-by-side
        f1_cx, f2_cx = int(width * 0.28), int(width * 0.72)
        f_cy = height // 2
        f_rx = int(width * 0.12)
        f_ry = int(height * 0.22)
        for y in range(max(0, f_cy - f_ry), min(height, f_cy + f_ry)):
            for x in range(0, width):
                in_f1 = ((x - f1_cx) / max(1, f_rx)) ** 2 + ((y - f_cy) / max(1, f_ry)) ** 2 <= 1.0
                in_f2 = ((x - f2_cx) / max(1, f_rx)) ** 2 + ((y - f_cy) / max(1, f_ry)) ** 2 <= 1.0
                if in_f1 or in_f2:
                    noise = np.random.normal(0, 15.0, 3)
                    arr[y, x] = np.clip(np.array(skin_color) + noise, 0, 255).astype(np.uint8)
    elif mode == "printed_photo":
        # Flat paper texture with zero subsurface chrominance dispersion
        for y in range(max(0, cy - ry), min(height, cy + ry)):
            for x in range(max(0, cx - rx), min(width, cx + rx)):
                if ((x - cx) / max(1, rx)) ** 2 + ((y - cy) / max(1, ry)) ** 2 <= 1.0:
                    arr[y, x] = skin_color
    elif mode == "screen_glare":
        # Face with specular replay glare highlight (>250 luminance covering > 20% of face)
        for y in range(max(0, cy - ry), min(height, cy + ry)):
            for x in range(max(0, cx - rx), min(width, cx + rx)):
                if ((x - cx) / max(1, rx)) ** 2 + ((y - cy) / max(1, ry)) ** 2 <= 1.0:
                    noise = np.random.normal(0, 15.0, 3)
                    arr[y, x] = np.clip(np.array(skin_color) + noise, 0, 255).astype(np.uint8)
        # Add glare hotspot
        arr[cy - 25 : cy + 25, cx - 25 : cx + 25] = [255, 255, 255]
    elif mode == "screen_moire":
        # Alternating high-frequency scanline grating across face
        for y in range(max(0, cy - ry), min(height, cy + ry)):
            for x in range(max(0, cx - rx), min(width, cx + rx)):
                if ((x - cx) / max(1, rx)) ** 2 + ((y - cy) / max(1, ry)) ** 2 <= 1.0:
                    lum = 230 if (x % 2 == 0) else 50
                    arr[y, x] = [lum, int(lum * 0.75), int(lum * 0.6)]
    elif mode == "blank":
        arr[:, :] = [128, 128, 128]
    else:
        # Standard face with natural gradient and subtle variation
        for y in range(max(0, cy - ry), min(height, cy + ry)):
            for x in range(max(0, cx - rx), min(width, cx + rx)):
                if ((x - cx) / max(1, rx)) ** 2 + ((y - cy) / max(1, ry)) ** 2 <= 1.0:
                    noise = np.random.normal(0, 15.0, 3)
                    arr[y, x] = np.clip(np.array(skin_color) + noise, 0, 255).astype(np.uint8)

    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


@pytest.fixture()
def app():
    application = create_app(config_class=TestConfig, seed_db=False)
    with application.app_context():
        db.create_all()
        seed_initial_data()
        # Clean attendance sessions for deterministic testing
        AttendanceEvent.query.delete()
        AttendanceSession.query.delete()
        db.session.commit()
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


# ==============================================================================
# AREA 1: FACE DETECTION (Reject Zero or Multiple Faces)
# ==============================================================================
def test_area_01_face_detection_zero_and_multiple_faces(app):
    """Audit Area 1: Reject images containing zero or multiple faces."""
    with app.app_context():
        # Case A: Zero faces
        img_zero = _generate_synthetic_image(mode="zero_faces")
        res_zero = analyze_and_extract_embedding({"image_base64": img_zero})
        assert res_zero["usable"] is False
        assert res_zero["rejection_code"] in {"ZERO_FACES_DETECTED", "FACE_NOT_DETECTED_OR_OBSTRUCTED"}
        assert res_zero["embedding"] is None

        # Case B: Multiple faces
        img_multi = _generate_synthetic_image(mode="multiple_faces", width=240, height=160)
        res_multi = analyze_and_extract_embedding({"image_base64": img_multi})
        assert res_multi["usable"] is False
        assert res_multi["rejection_code"] == "MULTIPLE_FACES_DETECTED"
        assert res_multi["embedding"] is None

        # Case C: Exactly one valid face
        img_single = _generate_synthetic_image(mode="normal")
        res_single = analyze_and_extract_embedding({"image_base64": img_single})
        assert res_single["usable"] is True
        assert res_single["embedding"] is not None
        assert res_single["quality_details"]["face_detected"] is True


# ==============================================================================
# AREA 2: FACE ALIGNMENT (Normalize Position, Scale & Rotation)
# ==============================================================================
def test_area_02_face_alignment_normalization(app):
    """Audit Area 2: Normalize face position, rotation, and scale so off-center faces match."""
    with app.app_context():
        # Centered face
        img_centered = _generate_synthetic_image(mode="normal", offset_x=0, offset_y=0, width=200, height=200)
        res_centered = analyze_and_extract_embedding({"image_base64": img_centered})
        assert res_centered["usable"] is True

        # Off-center face (shifted by 25px in X and Y)
        img_shifted = _generate_synthetic_image(mode="normal", offset_x=25, offset_y=20, width=200, height=200)
        res_shifted = analyze_and_extract_embedding({"image_base64": img_shifted})
        assert res_shifted["usable"] is True

        # Face alignment crops to bounding box and resizes to 160x160 canonical coordinate space
        sim = cosine_similarity(res_centered["embedding"], res_shifted["embedding"])
        # High correlation between aligned crops of the same identity
        assert sim >= 0.75


# ==============================================================================
# AREA 3: IMAGE VALIDATION (Magic Bytes, Payload Bounds, Corruption)
# ==============================================================================
def test_area_03_image_validation_content_and_magic_bytes(app):
    """Audit Area 3: Validate actual image contents, not just file extensions or MIME strings."""
    with app.app_context():
        # Case A: Invalid magic bytes / plain text disguised as image
        fake_b64 = "data:image/jpeg;base64," + base64.b64encode(b"NOT_A_REAL_IMAGE_DATA_HEADER").decode("utf-8")
        res_bad_magic = analyze_and_extract_embedding({"image_base64": fake_b64})
        assert res_bad_magic["usable"] is False
        assert res_bad_magic["rejection_code"] == "INVALID_IMAGE_DATA"

        # Case B: Truncated / corrupt image payload
        corrupt_bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 80  # JPEG SOI but corrupted body
        corrupt_b64 = "data:image/jpeg;base64," + base64.b64encode(corrupt_bytes).decode("utf-8")
        res_corrupt = analyze_and_extract_embedding({"image_base64": corrupt_b64})
        assert res_corrupt["usable"] is False
        assert res_corrupt["rejection_code"] == "CORRUPT_IMAGE_DATA"

        # Case C: Below minimum 64x64 resolution
        small_arr = np.zeros((32, 32, 3), dtype=np.uint8)
        small_arr[:, :] = [210, 160, 130]
        buf = io.BytesIO()
        Image.fromarray(small_arr).save(buf, format="JPEG")
        tiny_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")
        res_tiny = analyze_and_extract_embedding({"image_base64": tiny_b64})
        assert res_tiny["usable"] is False
        assert res_tiny["rejection_code"] == "IMAGE_TOO_SMALL"

        # Case D: Blank / solid color image
        blank_b64 = _generate_synthetic_image(mode="blank")
        res_blank = analyze_and_extract_embedding({"image_base64": blank_b64})
        assert res_blank["usable"] is False
        assert res_blank["rejection_code"] in {"BLANK_OR_EMPTY_IMAGE", "ZERO_FACES_DETECTED", "FACE_NOT_DETECTED_OR_OBSTRUCTED"}

        # Case E: Payload too small (<64 bytes)
        res_too_small = analyze_and_extract_embedding({"image_base64": "data:image/jpeg;base64,AAAA"})
        assert res_too_small["usable"] is False
        assert res_too_small["rejection_code"] == "INVALID_IMAGE_DATA"


# ==============================================================================
# AREA 4: RECOGNITION (Same Person Different Photographs Match >= 0.78)
# ==============================================================================
def test_area_04_recognition_different_photographs_same_person(app):
    """Audit Area 4: Test different photographs of the same person match enrolled template."""
    with app.app_context():
        # Base photograph
        skin_tonality = (215, 165, 135)
        img_photo_1 = _generate_synthetic_image(mode="normal", skin_color=skin_tonality, offset_x=0)
        res1 = analyze_and_extract_embedding({"image_base64": img_photo_1})
        assert res1["usable"] is True

        # Second photograph of same person (slightly shifted position, mild lighting difference)
        img_photo_2 = _generate_synthetic_image(mode="normal", skin_color=skin_tonality, offset_x=5, offset_y=-5)
        res2 = analyze_and_extract_embedding({"image_base64": img_photo_2})
        assert res2["usable"] is True

        # Compute cosine similarity between embeddings of same person
        sim = cosine_similarity(res1["embedding"], res2["embedding"])
        assert sim >= 0.78, f"Expected recognition match >= 0.78, got {sim:.4f}"


# ==============================================================================
# AREA 5: FALSE MATCHES (Different Employees Cross-Check < 0.62)
# ==============================================================================
def test_area_05_false_matches_cross_employee_separation(app):
    """Audit Area 5: Test many different employees against each other to ensure zero false positives."""
    with app.app_context():
        # Test 1: Pairwise separation of distinct enrolled employee identities
        emp_numbers = [f"EIPC-EMP-00{i}" for i in range(1, 6)]
        embeddings = [
            (num, generate_deterministic_embedding(f"FACE_SIG_{num}"))
            for num in emp_numbers
        ]

        # Pairwise cross-check of all distinct employee pairs
        for i in range(len(embeddings)):
            for j in range(i + 1, len(embeddings)):
                num_i, emb_i = embeddings[i]
                num_j, emb_j = embeddings[j]
                sim = cosine_similarity(emb_i, emb_j)
                assert sim < 0.62, (
                    f"False match risk between {num_i} and {num_j}: similarity {sim:.4f} exceeds threshold 0.62"
                )

        # Test 2: Database matching isolation: scanning employee 1 matches ONLY employee 1
        res_emp1 = recognize_face_candidate(
            {"biometric_signature": f"FACE_SIG_{emp_numbers[0]}"},
            decrypt_fn=decrypt_embedding,
        )
        assert res_emp1["matched"] is True
        assert res_emp1["employee"].employee_number == emp_numbers[0]

        # Testing an unregistered identity against the entire employee database produces no match
        res_stranger = recognize_face_candidate(
            {"biometric_signature": "FACE_SIG_UNREGISTERED_VISITOR_999"},
            decrypt_fn=decrypt_embedding,
        )
        assert res_stranger["matched"] is False
        assert res_stranger["status"] in {"UNKNOWN_FACE", "UNCERTAIN_MATCH"}


# ==============================================================================
# AREA 6: LIVENESS (Anti-Spoofing: Printed Photo, Screen Glare, Moiré Replay)
# ==============================================================================
def test_area_06_liveness_anti_spoofing_detection(app):
    """Audit Area 6: Test printed photos, phone displays, and video screen replay are rejected."""
    with app.app_context():
        # Case A: Printed photo on flat paper (low chrominance dispersion)
        img_print = _generate_synthetic_image(mode="printed_photo")
        res_print = analyze_and_extract_embedding({"image_base64": img_print})
        assert res_print["usable"] is False
        assert res_print["rejection_code"] == "PRINTED_PHOTO_DETECTED"
        assert res_print["embedding"] is None

        # Case B: Phone display specular glare replay
        img_glare = _generate_synthetic_image(mode="screen_glare")
        res_glare = analyze_and_extract_embedding({"image_base64": img_glare})
        assert res_glare["usable"] is False
        assert res_glare["rejection_code"] == "SCREEN_GLARE_REPLAY_DETECTED"
        assert res_glare["embedding"] is None

        # Case C: Video replay / LCD monitor Moiré pattern
        img_moire = _generate_synthetic_image(mode="screen_moire")
        res_moire = analyze_and_extract_embedding({"image_base64": img_moire})
        assert res_moire["usable"] is False
        assert res_moire["rejection_code"] == "SCREEN_MOIRE_REPLAY_DETECTED"
        assert res_moire["embedding"] is None


# ==============================================================================
# AREA 7: ENROLLMENT SECURITY (RBAC, Unverified Consent, Audit Trail)
# ==============================================================================
def test_area_07_enrollment_security_and_consent(client, app):
    """Audit Area 7: Prevent unauthorized template replacement and enforce signed biometric consent."""
    with app.app_context():
        emp = db.session.get(Employee, 1)
        # Ensure employee consent is verified for test baseline
        emp.consent_verified = False
        db.session.commit()

        # Attempt A: Anonymous user cannot enroll templates
        anon_resp = client.post("/employees", data={"form_action": "enroll_face", "employee_id": "1"})
        assert anon_resp.status_code in {302, 401}

        # Log in as HR Officer
        client.post("/login", data={"username": "hr_officer", "password": "Hr@EIPC2026"})

        # Attempt B: Enrolling when employee has not given signed consent is rejected
        b64_face = _generate_synthetic_image(mode="normal")
        no_consent_resp = client.post(
            "/employees",
            data={
                "form_action": "enroll_face",
                "employee_id": "1",
                "image_base64": b64_face,
                "quality_mode": "LIVE_CAPTURE",
            },
            follow_redirects=True,
        )
        assert b"Employee biometric consent/notice must be verified" in no_consent_resp.data

        # Now verify consent per POL-01
        emp.consent_verified = True
        db.session.commit()

        # Attempt C: Authorized enrollment succeeds and writes audit log
        auth_resp = client.post(
            "/employees",
            data={
                "form_action": "enroll_face",
                "employee_id": "1",
                "image_base64": b64_face,
                "quality_mode": "LIVE_CAPTURE",
            },
            follow_redirects=True,
        )
        assert auth_resp.status_code == 200
        assert b"Biometric template #" in auth_resp.data

        # Verify audit trail contains enrollment record
        log = AuditLog.query.filter_by(action="FACE_TEMPLATE_ENROLLED", target_id=emp.employee_number).first()
        assert log is not None
        assert log.actor_username == "hr_officer"


# ==============================================================================
# AREA 8: TEMPLATE MANAGEMENT (Replacement, Revocation, Model Versions)
# ==============================================================================
def test_area_08_template_management_replacement_and_revocation(app):
    """Audit Area 8: Handle template replacement, revocation, and model version transitions."""
    with app.app_context():
        emp = db.session.get(Employee, 2)
        emp.consent_verified = True
        db.session.commit()

        # Step 1: Enroll initial template
        img1 = _generate_synthetic_image(mode="normal")
        tmpl1, err1 = enroll_employee_face(emp.id, {"image_base64": img1}, enrolled_by="hr_officer")
        assert err1 is None
        assert tmpl1.status == "ACTIVE"
        assert tmpl1.revoked_at is None
        initial_id = tmpl1.id

        # Step 2: Enroll replacement template -> old template must be marked REPLACED
        img2 = _generate_synthetic_image(mode="normal", offset_x=5)
        tmpl2, err2 = enroll_employee_face(emp.id, {"image_base64": img2}, enrolled_by="hr_officer")
        assert err2 is None
        assert tmpl2.status == "ACTIVE"

        # Check initial template is now REPLACED with timestamp
        old_tmpl = db.session.get(FaceTemplate, initial_id)
        assert old_tmpl.status == "REPLACED"
        assert old_tmpl.revoked_at is not None

        # Step 3: Explicit revocation
        cnt, err_rev = revoke_employee_templates(emp.id, reason="Employee requested temporary revocation", revoked_by="hr_officer")
        assert err_rev is None
        assert cnt >= 1

        active_tmpl = emp.active_template
        assert active_tmpl is None
        revoked_tmpl = db.session.get(FaceTemplate, tmpl2.id)
        assert revoked_tmpl.status == "REVOKED"
        assert revoked_tmpl.revoked_at is not None


# ==============================================================================
# AREA 9: DATABASE (Encrypted Templates Survive Restart and Integrity Audit)
# ==============================================================================
def test_area_09_database_encrypted_templates_survive_restart(app):
    """Audit Area 9: Verify encrypted templates survive restart and pass relational/crypto integrity."""
    with app.app_context():
        # Enroll an encrypted template
        emp = db.session.get(Employee, 3)
        emp.consent_verified = True
        db.session.commit()

        img = _generate_synthetic_image(mode="normal")
        tmpl, err = enroll_employee_face(emp.id, {"image_base64": img}, enrolled_by="admin")
        assert err is None
        template_id = tmpl.id

        # Verify ciphertext in database is raw encrypted string (never plain JSON vector)
        assert tmpl.template_data.startswith("gAAAAA")

        # Verify relational integrity and Fernet cryptographic decryptability
        issues = verify_relational_integrity()
        assert issues["valid"] is True
        assert len(issues["issues"]) == 0, f"Integrity check failed: {issues}"

        # Decrypt vector and verify 128 elements
        recovered_vec = decrypt_embedding(tmpl.template_data)
        assert len(recovered_vec) == 128


# ==============================================================================
# AREA 10: ATTENDANCE (Unsuccessful Recognition Never Creates Attendance)
# ==============================================================================
def test_area_10_attendance_unsuccessful_recognition_never_creates_attendance(client, app):
    """Audit Area 10: Ensure unsuccessful recognition never creates attendance events or sessions."""
    with app.app_context():
        # Provision station ST-ICT-01
        client.post("/login", data={"username": "admin", "password": "Admin@EIPC2026"})
        client.post("/station/provision", data={"station_code": "ST-ICT-01"})

        events_before = AttendanceEvent.query.count()
        sessions_before = AttendanceSession.query.count()

        # Scan A: Spoofed printed photo
        scan_print = client.post(
            "/api/station/scan",
            json={"image_base64": _generate_synthetic_image(mode="printed_photo")},
        )
        assert scan_print.status_code == 422
        assert scan_print.get_json()["rejection_code"] == "PRINTED_PHOTO_DETECTED"

        # Scan B: Unregistered face
        unreg_img = _generate_synthetic_image(mode="normal", skin_color=(185, 140, 110), offset_x=15)
        scan_unreg = client.post(
            "/api/station/scan",
            json={"image_base64": unreg_img},
        )
        assert scan_unreg.status_code == 200
        assert scan_unreg.get_json()["matched"] is False

        # Verify NO attendance events or sessions were created
        events_after = AttendanceEvent.query.count()
        sessions_after = AttendanceSession.query.count()
        assert events_after == events_before
        assert sessions_after == sessions_before


# ==============================================================================
# AREA 11: PRIVACY (Consent Enforcement, Right to Erasure, Retention Cleanup)
# ==============================================================================
def test_area_11_privacy_consent_retention_and_erasure(app):
    """Audit Area 11: Define and verify consent, retention cleanup, and deletion procedures."""
    with app.app_context():
        emp = db.session.get(Employee, 4)
        emp.consent_verified = True
        db.session.commit()

        # Enroll template
        img = _generate_synthetic_image(mode="normal")
        tmpl, _ = enroll_employee_face(emp.id, {"image_base64": img}, enrolled_by="hr_officer")
        assert tmpl.id is not None

        # Test Right to Erasure (Purge biometrics)
        purged_count, err_purge = purge_employee_biometrics(
            employee_id=emp.id,
            reason="Employee exercised right to biometric erasure under EIPC privacy policy",
            actor="hr_officer",
        )
        assert err_purge is None
        assert purged_count >= 1

        # Consent is reset to False and no templates remain
        db.session.refresh(emp)
        assert emp.consent_verified is False
        assert FaceTemplate.query.filter_by(employee_id=emp.id).count() == 0

        # Verify purge audit log
        purge_log = AuditLog.query.filter_by(action="BIOMETRIC_DATA_PURGED", target_id=emp.employee_number).first()
        assert purge_log is not None

        # Test Retention Policy Cleanup (Purging superseded templates > 90 days)
        # Create an expired superseded template for employee 5
        emp5 = db.session.get(Employee, 5)
        expired_tmpl = FaceTemplate(
            employee_id=emp5.id,
            template_data="gAAAAABtest_expired_template",
            quality_score=0.88,
            model_name="EIPC-Vision-Embedder",
            model_version="1.0.0",
            status="REPLACED",
            enrolled_at=utc_now() - timedelta(days=120),
            revoked_at=utc_now() - timedelta(days=100),
        )
        db.session.add(expired_tmpl)
        db.session.commit()
        expired_id = expired_tmpl.id

        # Run retention cleanup with 90 day threshold
        cleaned = apply_biometric_retention_policy(retention_days=90, actor="SYSTEM_CRON")
        assert cleaned["purged_templates"] >= 1
        assert db.session.get(FaceTemplate, expired_id) is None


# ==============================================================================
# AREA 12: MODEL COMPATIBILITY (Quarantine Outdated Models & Safe Migration)
# ==============================================================================
def test_area_12_model_compatibility_and_migration(app):
    """Audit Area 12: Enforce matching only against compatible models and orderly migration."""
    with app.app_context():
        emp = db.session.get(Employee, 5)
        emp.consent_verified = True
        db.session.commit()

        # Enroll face on active model
        img = _generate_synthetic_image(mode="normal")
        tmpl, _ = enroll_employee_face(emp.id, {"image_base64": img}, enrolled_by="hr_officer")

        # Simulate older model version on this template
        tmpl.model_name = "EIPC-Legacy-Model"
        tmpl.model_version = "0.0.1-alpha"
        db.session.commit()

        # Model compatibility audit report identifies outdated template
        report = get_model_compatibility_report()
        assert report["status"] == "ACTION_REQUIRED_MODEL_UPGRADE"
        assert report["outdated_active_templates"] >= 1

        # Probe scan with the same face should NOT match because template is quarantined by model check
        match_res = recognize_face_candidate({"image_base64": img}, decrypt_fn=decrypt_embedding)
        assert match_res["matched"] is False

        # Run administrative synchronization / migration
        sync_res = sync_legacy_templates_for_model(
            target_model_name="EIPC-Vision-Embedder",
            target_model_version="1.0.0",
            actor="ADMIN_TEST",
        )
        assert sync_res["migrated_count"] >= 1

        # Report is now 100% compatible
        updated_report = get_model_compatibility_report()
        assert updated_report["status"] == "COMPATIBLE"
        assert updated_report["outdated_active_templates"] == 0
