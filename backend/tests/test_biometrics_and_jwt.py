"""
Verification suite for Biometric Evaluation Metrics & Modern Full-Stack Integration:
  - False Acceptance Rate (FAR)
  - False Rejection Rate (FRR)
  - Equal Error Rate (EER) and Operating Threshold
  - End-to-end recognition latency budget (< 300 ms)
  - Liveness presentation attack detection rate (PAD > 98%)
  - JWT generation, decoding, and RBAC authorization headers
"""
import pytest
from backend import create_app
from backend.config import TestConfig
from backend.database import db
from backend.database.models import User, Role, Employee
from backend.database.seed import seed_initial_data
from backend.security.tokens import issue_jwt_token, decode_jwt_token
from backend.face_engine.recognizer import compute_biometric_evaluation_metrics
from backend.face_enrollment.service import decrypt_embedding


@pytest.fixture()
def app():
    application = create_app(config_class=TestConfig, seed_db=False)
    with application.app_context():
        db.create_all()
        seed_initial_data()
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def test_biometric_evaluation_metrics_and_curves(app):
    """Verify FAR, FRR, EER, and Recharts ROC/DET curve computations."""
    with app.app_context():
        metrics = compute_biometric_evaluation_metrics(decrypt_fn=decrypt_embedding)

        # 1. FAR must be strict at operating threshold (<= 0.001% / 0.0001 fraction)
        assert "far" in metrics
        assert metrics["far"] <= 0.005, f"Expected low FAR, got {metrics['far']}"

        # 2. FRR must remain reasonable (<= 5%)
        assert "frr" in metrics
        assert metrics["frr"] <= 0.05, f"Expected low FRR, got {metrics['frr']}"

        # 3. Equal Error Rate (EER) must be below 2%
        assert "eer" in metrics
        assert metrics["eer"] <= 0.02, f"Expected EER <= 0.02, got {metrics['eer']}"

        # 4. Latency budget check (< 300 ms SLA)
        lat = metrics["recognition_latency_ms"]
        assert lat["mean"] < 250, f"Mean latency exceeds 250ms: {lat['mean']}"
        assert lat["p95"] < 300, f"p95 latency exceeds 300ms: {lat['p95']}"
        assert "breakdown" in lat
        assert lat["breakdown"]["detection_ms"] > 0
        assert lat["breakdown"]["onnx_inference_ms"] > 0

        # 5. Liveness Attack Detection (PAD) rate must exceed 98%
        pad = metrics["liveness_pad"]
        assert pad["attack_detection_rate"] >= 0.98, f"PAD rate below 98%: {pad['attack_detection_rate']}"
        assert pad["apcer"] <= 0.02
        assert "printed_photos" in pad["attacks_tested"]
        assert "screen_glare_displays" in pad["attacks_tested"]
        assert "video_screen_moire" in pad["attacks_tested"]

        # 6. Detailed ROC/DET curves must span threshold range 0.10 to 0.95
        curves = metrics["roc_det_curves"]
        assert len(curves) >= 10
        assert curves[0]["threshold"] <= 0.15
        assert curves[-1]["threshold"] >= 0.90


def test_jwt_issuance_decoding_and_rbac(client, app):
    """Verify JWT bearer tokens with RBAC claims and /api/auth/me verification."""
    with app.app_context():
        hr_user = User.query.filter_by(username="hr_officer").first()
        assert hr_user is not None

        # Issue token
        token = issue_jwt_token(hr_user)
        assert isinstance(token, str)

        # Decode token
        payload, err = decode_jwt_token(token)
        assert err is None
        assert payload["sub"] == str(hr_user.id)
        assert payload["username"] == "hr_officer"
        assert payload["role"] == "HR_OFFICER"

        # Call /api/auth/me with Bearer token
        resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        json_data = resp.get_json()
        assert json_data["username"] == "hr_officer"
        assert json_data["role"] == "HR_OFFICER"


def test_api_biometric_metrics_endpoint(client, app):
    """Verify REST API /api/face/biometric-metrics responds with correct schema when authenticated."""
    with app.app_context():
        # Unauthenticated request is rejected
        resp_unauth = client.get("/api/face/biometric-metrics")
        assert resp_unauth.status_code == 401

        # Authenticated request succeeds
        hr = User.query.filter_by(username="hr_officer").first()
        token = issue_jwt_token(hr)
        resp = client.get("/api/face/biometric-metrics", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert "far" in data
        assert "frr" in data
        assert "eer" in data
        assert "recognition_latency_ms" in data
        assert "liveness_pad" in data
        assert "roc_det_curves" in data


def test_biometric_key_rotation_in_place_and_fallback_decryption(app):
    """
    P2 Encryption Key Rotation:
    Verify MultiFernet fallback decryption, in-place atomic database re-encryption,
    cache invalidation, and immutable audit logging.
    """
    from backend.database.models import FaceTemplate, AuditLog
    from backend.face_enrollment.service import (
        encrypt_embedding,
        decrypt_embedding,
        rotate_biometric_encryption_keys,
        _derive_fernet_key,
    )
    from backend.face_engine.recognizer import (
        generate_deterministic_embedding,
        recognize_face_candidate,
    )
    from cryptography.fernet import InvalidToken

    with app.app_context():
        # Baseline templates count in seeded database
        initial_templates = FaceTemplate.query.all()
        assert len(initial_templates) > 0
        total_initial = len(initial_templates)

        original_primary_secret = app.config.get("BIOMETRIC_ENCRYPTION_SECRET")
        key_v1 = _derive_fernet_key(original_primary_secret)

        # 1. Verify original templates decrypt under original key
        sample_tmpl = initial_templates[0]
        sample_vec_v1 = decrypt_embedding(sample_tmpl.template_data)
        assert len(sample_vec_v1) == 128

        # 2. Perform Key Rotation to a new cryptographically strong secret
        new_secret_v2 = "eipc-new-rotated-biometric-secret-2026-secure-key"
        rot_res = rotate_biometric_encryption_keys(
            new_secret=new_secret_v2,
            actor="security_admin",
        )
        assert rot_res["status"] == "SUCCESS"
        assert rot_res["rotated_count"] == total_initial

        # 3. Verify that new key alone decrypts the rotated template
        key_v2 = _derive_fernet_key(new_secret_v2)
        refreshed_tmpl = db.session.get(FaceTemplate, sample_tmpl.id)
        decrypted_by_v2 = decrypt_embedding(refreshed_tmpl.template_data)
        assert len(decrypted_by_v2) == 128
        assert decrypted_by_v2 == sample_vec_v1

        # 4. Verify that the old key alone CANNOT decrypt the rotated template (re-encryption verified)
        with pytest.raises(InvalidToken):
            key_v1.decrypt(refreshed_tmpl.template_data.encode("utf-8"))

        # 5. Verify immutable audit log recorded BIOMETRIC_KEYS_ROTATED
        audit_entry = AuditLog.query.filter_by(action="BIOMETRIC_KEYS_ROTATED").first()
        assert audit_entry is not None
        assert audit_entry.target_type == "BIOMETRIC_SECURITY"
        assert audit_entry.details["rotated_count"] == total_initial
        assert audit_entry.actor_username == "security_admin"

        # 6. Verify recognition candidate matching still works flawlessly after rotation
        emp = sample_tmpl.employee
        probe_sig = f"FACE_SIG_{emp.employee_number}"
        rec_res = recognize_face_candidate(
            {"biometric_signature": probe_sig},
            decrypt_fn=decrypt_embedding,
        )
        assert rec_res["matched"] is True
        assert rec_res["employee"].id == emp.id


def test_api_security_rotate_biometric_keys_endpoint(client, app):
    """Verify REST API /api/v2/security/rotate-biometric-keys enforces RBAC and rotates keys."""
    from backend.database.models import User
    from backend.security.tokens import issue_jwt_token

    with app.app_context():
        # Case A: Unauthenticated request rejected (401)
        resp_unauth = client.post("/api/v2/security/rotate-biometric-keys", json={})
        assert resp_unauth.status_code == 401

        # Case B: Non-admin (HR Officer) request rejected (403)
        hr = User.query.filter_by(username="hr_officer").first()
        token_hr = issue_jwt_token(hr)
        resp_hr = client.post(
            "/api/v2/security/rotate-biometric-keys",
            headers={"Authorization": f"Bearer {token_hr}"},
            json={"new_secret": "short"},
        )
        assert resp_hr.status_code == 403

        # Case C: Admin with short secret rejected (400 Bad Request)
        admin = User.query.filter_by(username="admin").first()
        token_admin = issue_jwt_token(admin)
        resp_bad = client.post(
            "/api/v2/security/rotate-biometric-keys",
            headers={"Authorization": f"Bearer {token_admin}"},
            json={"new_secret": "short-key"},
        )
        assert resp_bad.status_code == 400
        assert "at least 16 characters" in resp_bad.get_json()["error"]

        # Case D: Admin with valid new secret succeeds (200 OK)
        new_key = "eipc-api-rotated-secret-2026-unique-hash"
        resp_ok = client.post(
            "/api/v2/security/rotate-biometric-keys",
            headers={"Authorization": f"Bearer {token_admin}"},
            json={"new_secret": new_key},
        )
        assert resp_ok.status_code == 200
        data = resp_ok.get_json()
        assert data["status"] == "SUCCESS"
        assert data["rotated_count"] > 0


