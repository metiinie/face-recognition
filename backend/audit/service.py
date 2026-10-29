"""
Append-only audit logging service for sensitive HR and Administrator operations.
Satisfies Section 1 (MySQL and security), Section 4 (audit module), and AT-23.
"""
import json
from flask import request, has_request_context, session
from backend.database import db
from backend.database.models import AuditLog, utc_now


def record_audit_log(
    action: str,
    target_type: str,
    target_id: str | int | None = None,
    reason: str | None = None,
    details: dict | None = None,
    actor_user_id: int | None = None,
    actor_username: str | None = None,
    station_id: int | None = None,
    commit: bool = False,
) -> AuditLog:
    """
    Append an immutable audit record to audit_logs.
    """
    ip_addr = None
    if has_request_context():
        ip_addr = request.remote_addr or "127.0.0.1"
        if actor_user_id is None:
            actor_user_id = session.get("user_id")
        if actor_username is None:
            actor_username = session.get("username", "SYSTEM")

    log_entry = AuditLog(
        actor_user_id=actor_user_id,
        actor_username=actor_username or "SYSTEM",
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        reason=reason,
        details_json=json.dumps(details, default=str) if details else None,
        station_id=station_id,
        ip_address=ip_addr,
        created_at=utc_now(),
    )
    db.session.add(log_entry)
    if commit:
        db.session.commit()
    return log_entry

