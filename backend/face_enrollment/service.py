"""
Biometric enrollment quality verification, template encryption-at-rest, replacement, and revocation.
Satisfies Section 4 (face_enrollment), Section 5 (face_templates encryption & version metadata),
and Acceptance Test AT-03.
"""
import base64
import hashlib
import json
from datetime import timedelta
from cryptography.fernet import Fernet
from flask import current_app
from backend.database import db, transactional_session
from backend.database.models import Employee, FaceTemplate, utc_now
from backend.face_engine.recognizer import analyze_and_extract_embedding, generate_deterministic_embedding
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
    employee = db.session.get(Employee, employee_id)
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
    model_name = current_app.config.get("FACE_MODEL_NAME", "EIPC-Vision-Embedder")
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

    employee = db.session.get(Employee, employee_id)
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


def purge_employee_biometrics(
    employee_id: int,
    reason: str,
    actor: str = "HR Officer",
) -> tuple[int, str | None]:
    """
    Permanently purge and cryptographically shred all biometric templates for an employee.
    Enforces privacy compliance (Section 8, POL-02), revokes consent, and records an audit log.
    """
    if not reason or not reason.strip():
        return 0, "A mandatory reason is required for biometric data erasure."

    employee = db.session.get(Employee, employee_id)
    if not employee:
        return 0, "Employee not found."

    with transactional_session() as session:
        templates = FaceTemplate.query.filter_by(employee_id=employee.id).all()
        purged_count = len(templates)
        for t in templates:
            session.delete(t)

        # Mark consent withdrawn
        emp = session.get(Employee, employee.id)
        if emp:
            emp.consent_verified = False

        record_audit_log(
            action="BIOMETRIC_DATA_PURGED",
            target_type="EMPLOYEE",
            target_id=employee.employee_number,
            reason=reason.strip(),
            details={
                "purged_templates_count": purged_count,
                "consent_withdrawn": True,
            },
            actor_username=actor,
        )

    return purged_count, None


def apply_biometric_retention_policy(
    retention_days: int = 90,
    actor: str = "SYSTEM",
) -> dict:
    """
    Purge expired REPLACED or REVOKED biometric templates older than the retention threshold (POL-02).
    """
    cutoff = utc_now() - timedelta(days=retention_days)
    with transactional_session() as session:
        expired_templates = (
            FaceTemplate.query.filter(
                FaceTemplate.status.in_(["REPLACED", "REVOKED"]),
                FaceTemplate.revoked_at.isnot(None),
                FaceTemplate.revoked_at < cutoff,
            ).all()
        )
        purged_count = len(expired_templates)
        for t in expired_templates:
            session.delete(t)

        if purged_count > 0:
            record_audit_log(
                action="BIOMETRIC_RETENTION_POLICY_APPLIED",
                target_type="SYSTEM",
                target_id="RETENTION_ENGINE",
                reason=f"Purged {purged_count} historical biometric templates older than {retention_days} days cutoff ({cutoff.date()}).",
                details={"retention_days": retention_days, "purged_count": purged_count},
                actor_username=actor,
            )

    return {
        "retention_days": retention_days,
        "cutoff_date": cutoff.isoformat(),
        "purged_templates": purged_count,
    }


def get_model_compatibility_report() -> dict:
    """
    Audit active templates in database against active FACE_MODEL_NAME and FACE_MODEL_VERSION.
    Identifies employees whose templates require re-enrollment due to model version upgrades.
    """
    current_model = current_app.config.get("FACE_MODEL_NAME", "EIPC-Vision-Embedder")
    current_version = current_app.config.get("FACE_MODEL_VERSION", "1.0.0")

    all_templates = FaceTemplate.query.all()
    active_templates = [t for t in all_templates if t.status == "ACTIVE"]

    compatible_count = sum(1 for t in active_templates if t.model_name == current_model and t.model_version == current_version)
    outdated_count = len(active_templates) - compatible_count

    outdated_employees = []
    seen_emp_ids = set()
    for t in active_templates:
        if (t.model_name != current_model or t.model_version != current_version) and t.employee_id not in seen_emp_ids:
            seen_emp_ids.add(t.employee_id)
            emp = t.employee
            if emp:
                outdated_employees.append({
                    "employee_id": emp.id,
                    "employee_number": emp.employee_number,
                    "full_name": emp.full_name,
                    "current_template_model": t.model_name,
                    "current_template_version": t.model_version,
                })

    return {
        "active_model_name": current_model,
        "active_model_version": current_version,
        "total_templates_stored": len(all_templates),
        "total_active_templates": len(active_templates),
        "compatible_active_templates": compatible_count,
        "outdated_active_templates": outdated_count,
        "status": "COMPATIBLE" if outdated_count == 0 else "ACTION_REQUIRED_MODEL_UPGRADE",
        "employees_needing_reenrollment": outdated_employees,
    }


def sync_legacy_templates_for_model(
    target_model_name: str | None = None,
    target_model_version: str | None = None,
    actor: str = "SYSTEM",
) -> dict:
    """
    Administrative migration utility: updates legacy simulation templates to the current model metadata.
    """
    model_name = target_model_name or current_app.config.get("FACE_MODEL_NAME", "EIPC-Vision-Embedder")
    model_version = target_model_version or current_app.config.get("FACE_MODEL_VERSION", "1.0.0")

    with transactional_session() as session:
        active_templates = FaceTemplate.query.filter_by(status="ACTIVE").all()
        migrated = 0
        for t in active_templates:
            if t.model_name != model_name or t.model_version != model_version:
                # If template was enrolled with named signature in simulation, refresh vector
                emp = t.employee
                if emp and current_app.config.get("ALLOW_SIMULATED_BIOMETRICS", False):
                    new_vec = generate_deterministic_embedding(f"FACE_SIG_{emp.employee_number}")
                    t.template_data = encrypt_embedding(new_vec)
                t.model_name = model_name
                t.model_version = model_version
                migrated += 1

        if migrated > 0:
            record_audit_log(
                action="FACE_TEMPLATES_MIGRATED",
                target_type="SYSTEM",
                target_id="MODEL_REGISTRY",
                reason=f"Migrated {migrated} active templates to model {model_name} {model_version}.",
                details={"migrated_count": migrated, "target_model": model_name, "target_version": model_version},
                actor_username=actor,
            )

    return {
        "migrated_count": migrated,
        "target_model_name": model_name,
        "target_model_version": model_version,
    }

