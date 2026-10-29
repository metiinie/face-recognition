"""Face enrollment and biometric encryption-at-rest module."""
from backend.face_enrollment.service import (
    encrypt_embedding,
    decrypt_embedding,
    enroll_employee_face,
    revoke_employee_templates,
)

__all__ = [
    "encrypt_embedding",
    "decrypt_embedding",
    "enroll_employee_face",
    "revoke_employee_templates",
]

