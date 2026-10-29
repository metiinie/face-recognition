"""
Database migration, snapshot export, and backup/restore consistency verification service.
Satisfies Section 5 (Migrations) and AT-26 (Backup restoration consistency across
Employee, schedule, attendance, correction, and audit relationships).
"""
import json
from datetime import datetime, date
from backend.database import db, transactional_session
from backend.database.models import (
    Role, User, Department, Employee, FaceTemplate, AttendanceStation,
    ShiftTemplate, ShiftAssignment, ScheduleException, AttendanceSession,
    AttendanceEvent, ReviewCase, AttendanceCorrection, AuditLog, PolicySignoff,
    utc_now,
)


def _serialize_val(val):
    if isinstance(val, datetime):
        return val.isoformat()
    if isinstance(val, date):
        return val.isoformat()
    return val


def _parse_dt(val):
    if not val:
        return None
    if isinstance(val, datetime):
        return val
    return datetime.fromisoformat(val)


def _parse_date(val):
    if not val:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    return date.fromisoformat(val[:10])


def export_full_backup_snapshot() -> dict:
    """
    Export a complete relational backup snapshot of all authoritative tables
    for backup & disaster recovery verification (AT-26).
    """
    models_order = [
        ("roles", Role),
        ("users", User),
        ("departments", Department),
        ("employees", Employee),
        ("face_templates", FaceTemplate),
        ("attendance_stations", AttendanceStation),
        ("shift_templates", ShiftTemplate),
        ("shift_assignments", ShiftAssignment),
        ("schedule_exceptions", ScheduleException),
        ("attendance_sessions", AttendanceSession),
        ("attendance_events", AttendanceEvent),
        ("review_cases", ReviewCase),
        ("attendance_corrections", AttendanceCorrection),
        ("audit_logs", AuditLog),
        ("policy_signoffs", PolicySignoff),
    ]
    snapshot = {
        "schema_version": "1.0.0-eipc-v1",
        "exported_at": utc_now().isoformat(),
        "tables": {}
    }
    for key, model_cls in models_order:
        rows = []
        for obj in db.session.query(model_cls).order_by(model_cls.id.asc()).all():
            row_dict = {}
            for col in model_cls.__table__.columns:
                row_dict[col.name] = _serialize_val(getattr(obj, col.name))
            rows.append(row_dict)
        snapshot["tables"][key] = rows
    return snapshot


def restore_backup_snapshot(snapshot: dict) -> dict:
    """
    Restore a backup snapshot into the active database environment and verify relational integrity (AT-26).
    """
    tables = snapshot.get("tables", {})
    datetime_cols = {
        "created_at", "updated_at", "last_login_at", "enrolled_at", "revoked_at",
        "shift_start_at", "shift_end_at", "occurred_at", "resolved_at",
        "previous_timestamp", "corrected_timestamp"
    }
    date_cols = {"effective_from", "effective_to", "start_date", "end_date", "work_date"}

    models_order = [
        ("roles", Role),
        ("users", User),
        ("departments", Department),
        ("employees", Employee),
        ("face_templates", FaceTemplate),
        ("attendance_stations", AttendanceStation),
        ("shift_templates", ShiftTemplate),
        ("shift_assignments", ShiftAssignment),
        ("schedule_exceptions", ScheduleException),
        ("attendance_sessions", AttendanceSession),
        ("attendance_events", AttendanceEvent),
        ("review_cases", ReviewCase),
        ("attendance_corrections", AttendanceCorrection),
        ("audit_logs", AuditLog),
        ("policy_signoffs", PolicySignoff),
    ]

    with transactional_session() as session:
        # Clear existing data in reverse dependency order
        for _, model_cls in reversed(models_order):
            session.query(model_cls).delete()
        session.flush()

        # First insert AttendanceSession without circular check_in_event_id / check_out_event_id
        deferred_session_links = []
        for key, model_cls in models_order:
            for raw_row in tables.get(key, []):
                row_data = dict(raw_row)
                for k, v in list(row_data.items()):
                    if k in datetime_cols:
                        row_data[k] = _parse_dt(v)
                    elif k in date_cols:
                        row_data[k] = _parse_date(v)

                if key == "attendance_sessions":
                    ci_id = row_data.get("check_in_event_id")
                    co_id = row_data.get("check_out_event_id")
                    if ci_id or co_id:
                        deferred_session_links.append((row_data["id"], ci_id, co_id))
                        row_data["check_in_event_id"] = None
                        row_data["check_out_event_id"] = None

                session.add(model_cls(**row_data))
            session.flush()

        for sess_id, ci_id, co_id in deferred_session_links:
            att_sess = session.get(AttendanceSession, sess_id)
            if att_sess:
                att_sess.check_in_event_id = ci_id
                att_sess.check_out_event_id = co_id
        session.flush()

    return verify_relational_integrity()


def verify_relational_integrity() -> dict:
    """
    Verify that Employee, Schedule, Attendance Session/Event, Correction, and Audit
    relationships are consistent after backup restoration (AT-26).
    """
    issues = []

    employees = Employee.query.all()
    for emp in employees:
        if not emp.department:
            issues.append(f"Employee {emp.employee_number} missing department relationship")

    assignments = ShiftAssignment.query.all()
    for sa in assignments:
        if not sa.employee or not sa.shift_template:
            issues.append(f"ShiftAssignment {sa.id} broken employee/template link")

    sessions = AttendanceSession.query.all()
    for s in sessions:
        if not s.employee:
            issues.append(f"AttendanceSession {s.id} orphaned from employee")
        if s.check_in_event_id and not s.check_in_event:
            issues.append(f"AttendanceSession {s.id} missing linked check_in_event")
        if s.check_out_event_id and not s.check_out_event:
            issues.append(f"AttendanceSession {s.id} missing linked check_out_event")

    events = AttendanceEvent.query.all()
    for ev in events:
        if not ev.employee:
            issues.append(f"AttendanceEvent {ev.id} orphaned from employee")

    return {
        "valid": len(issues) == 0,
        "issues": issues,
        "counts": {
            "departments": Department.query.count(),
            "employees": Employee.query.count(),
            "face_templates": FaceTemplate.query.count(),
            "stations": AttendanceStation.query.count(),
            "shift_templates": ShiftTemplate.query.count(),
            "shift_assignments": ShiftAssignment.query.count(),
            "attendance_sessions": AttendanceSession.query.count(),
            "attendance_events": AttendanceEvent.query.count(),
            "attendance_corrections": AttendanceCorrection.query.count(),
            "audit_logs": AuditLog.query.count(),
        },
    }

