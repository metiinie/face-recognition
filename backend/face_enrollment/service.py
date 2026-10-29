"""
Biometric enrollment quality verification, template encryption-at-rest, replacement, and revocation.
Satisfies Section 4 (face_enrollment), Section 5 (face_templates encryption & version metadata),
and Acceptance Test AT-03.
"""
import base64
import hashlib
import json
from cryptography.fernet import Fernet
from flask import current_app
from backend.database import transactional_session
from backend.database.models import Employee, FaceTemplate, utc_now
from backend.face_engine.recognizer import analyze_and_extract_embedding
from backend.audit.service import record_audit_log


def _get_fernet() -> Fernet:
    """Derive a 32-byte URL-safe base64 Fernet key from BIOMETRIC_ENCRYPTION_SECRET."""
    secret = current_app.config.get(
        "BIOMETRIC_ENCRYPTION_SECRET",
        "eipc-biometric-template-protection-secret-key-2026"
    )
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    fernet_key = base64.urlsafe_b64encode(digest)
    return Fernet(fernet_key)


def encrypt_embedding(embedding: list[float]) -> str:
    """Encrypt a 128-D float embedding vector for storage at rest in face_templates."""
    f = _get_fernet()
    payload = json.dumps(embedding).encode("utf-8")
    return f.encrypt(payload).decode("utf-8")


def decrypt_embedding(encrypted_text: str) -> list[float]:
    """Decrypt an encrypted template_data string back into a 128-D float vector."""
    f = _get_fernet()
    raw = f.decrypt(encrypted_text.encode("utf-8"))
    return json.loads(raw.decode("utf-8"))


def enroll_employee_face(
    employee_id: int,
    capture_payload: dict,
    enrolled_by: str = "HR Officer",
) -> tuple[FaceTemplate | None, str | None]:
    """
    Validate image quality, extract embedding, encrypt at rest, replace prior active templates,
    and save a new FaceTemplate record with model/version metadata (AT-03).
    """
    employee = Employee.query.get(employee_id)
    if not employee:
        return None, "Employee not found."

    if not employee.consent_verified:
        return None, "Employee biometric consent/notice must be verified before enrolling a face template."

    extraction = analyze_and_extract_embedding(capture_payload)
    if not extraction["usable"]:
        record_audit_log(
            action="FACE_ENROLLMENT_REJECTED_QUALITY",
            target_type="EMPLOYEE",
            target_id=employee.employee_number,
            reason=extraction["rejection_message"],
            details=extraction["quality_details"],
            actor_username=enrolled_by,
            commit=True,
        )
        return None, extraction["rejection_message"]

    encrypted_blob = encrypt_embedding(extraction["embedding"])
    model_name = current_app.config.get("FACE_MODEL_NAME", "EIPC-ArcFace-Embedder")
    model_version = current_app.config.get("FACE_MODEL_VERSION", "1.0.0")

    with transactional_session() as session:
        # Mark existing ACTIVE templates for this employee as REPLACED
        prior_templates = FaceTemplate.query.filter_by(
            employee_id=employee.id, status="ACTIVE"
        ).all()
        for old_t in prior_templates:
            old_t.status = "REPLACED"
            old_t.revoked_at = utc_now()
            old_t.revoke_reason = "Replaced by new biometric enrollment"

        new_template = FaceTemplate(
            employee_id=employee.id,
            template_data=encrypted_blob,
            model_name=model_name,
            model_version=model_version,
            quality_score=extraction["quality_score"],
            status="ACTIVE",
            enrolled_by=enrolled_by,
            enrolled_at=utc_now(),
        )
        session.add(new_template)
        session.flush()

        record_audit_log(
            action="FACE_TEMPLATE_ENROLLED",
            target_type="EMPLOYEE",
            target_id=employee.employee_number,
            reason="Biometric template enrolled after quality verification",
            details={
                "template_id": new_template.id,
                "model_name": model_name,
                "model_version": model_version,
                "quality_score": new_template.quality_score,
                "replaced_count": len(prior_templates),
            },
            actor_username=enrolled_by,
        )

    return new_template, None


def revoke_employee_templates(
    employee_id: int,
    reason: str,
    revoked_by: str = "HR Officer",
) -> tuple[int, str | None]:
    """Revoke all active biometric templates for an employee with mandatory reason."""
    if not reason or not reason.strip():
        return 0, "A revocation reason is required."

    employee = Employee.query.get(employee_id)
    if not employee:
        return 0, "Employee not found."

    with transactional_session():
        active_list = FaceTemplate.query.filter_by(
            employee_id=employee.id, status="ACTIVE"
        ).all()
        for tmpl in active_list:
            tmpl.status = "REVOKED"
            tmpl.revoked_at = utc_now()
            tmpl.revoke_reason = reason.strip()

        record_audit_log(
            action="FACE_TEMPLATE_REVOKED",
            target_type="EMPLOYEE",
            target_id=employee.employee_number,
            reason=reason.strip(),
            details={"revoked_count": len(active_list)},
            actor_username=revoked_by,
        )

    return len(active_list), None

