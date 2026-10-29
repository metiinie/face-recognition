"""
Handles unknown-face review cases (Journey C), authorized manual HR attendance entries,
and non-destructive attendance corrections that preserve original event history (AT-23).
"""
from datetime import datetime
from backend.database import db, transactional_session
from backend.database.models import (
    Employee,
    AttendanceStation,
    AttendanceSession,
    AttendanceEvent,
    ReviewCase,
    AttendanceCorrection,
    User,
    utc_now,
)
from backend.attendance.service import confirm_attendance_action
from backend.shifts.service import evaluate_arrival_punctuality
from backend.audit.service import record_audit_log


def create_review_case(
    station_id: int | None,
    case_type: str,
    reason: str,
    intended_action: str | None = None,
    claimed_employee_number: str | None = None,
    candidate_employee_id: int | None = None,
    recognition_score: float | None = None,
) -> ReviewCase:
    """
    Create an HR review case when recognition fails or an employee requests assistance
    after an invalid action (Journey B & Journey C).
    """
    with transactional_session() as session:
        rc = ReviewCase(
            station_id=station_id,
            candidate_employee_id=candidate_employee_id,
            claimed_employee_number=(
                claimed_employee_number.strip().upper() if claimed_employee_number else None
            ),
            case_type=case_type.strip().upper(),
            intended_action=intended_action.strip().upper() if intended_action else None,
            reason=reason.strip(),
            recognition_score=recognition_score,
            status="OPEN",
            created_at=utc_now(),
        )
        session.add(rc)
        session.flush()

        record_audit_log(
            action="REVIEW_CASE_CREATED",
            target_type="REVIEW_CASE",
            target_id=rc.id,
            reason=rc.reason,
            details={
                "case_type": rc.case_type,
                "claimed_employee_number": rc.claimed_employee_number,
                "station_id": station_id,
            },
            station_id=station_id,
        )
    return rc


def record_manual_hr_attendance(
    hr_user: User,
    employee_id: int,
    station_id: int,
    event_type: str,
    reason: str,
    evidence_reference: str,
    occurred_at: datetime | None = None,
    review_case_id: int | None = None,
) -> tuple[dict | None, str | None]:
    """
    Record an authorized Manual HR attendance entry (Journey C).
    Distinguished from biometric events via `capture_method='MANUAL_HR'`.
    Requires mandatory reason, HR actor, and policy evidence reference.
    """
    if not reason or len(reason.strip()) < 5:
        return None, "A documented reason (at least 5 characters) is mandatory for manual HR attendance."
    if not evidence_reference or not evidence_reference.strip():
        return None, "Policy evidence/ID verification reference is required for manual HR attendance."

    station = db.session.get(AttendanceStation, station_id)
    if not station:
        return None, "Selected station not found."

    result, err_code, err_msg = confirm_attendance_action(
        employee_id=employee_id,
        station=station,
        event_type=event_type,
        recognition_score=None,
        occurred_at=occurred_at,
        capture_method="MANUAL_HR",
        recorded_by_user_id=hr_user.id,
        manual_reason=reason.strip(),
        evidence_ref=evidence_reference.strip(),
    )
    if err_code:
        return None, err_msg

    with transactional_session() as session:
        if review_case_id:
            rc = session.get(ReviewCase, review_case_id)
            if rc:
                rc.status = "APPROVED_MANUAL_ENTRY"
                rc.resolution_notes = reason.strip()
                rc.evidence_reference = evidence_reference.strip()
                rc.resolved_by_user_id = hr_user.id
                rc.resolved_event_id = result["event_id"]
                rc.resolved_at = utc_now()

        record_audit_log(
            action="MANUAL_ATTENDANCE_RECORDED",
            target_type="ATTENDANCE_EVENT",
            target_id=result["event_id"],
            reason=reason.strip(),
            details={
                "employee_number": result["employee_number"],
                "event_type": result["event_type"],
                "capture_method": "MANUAL_HR",
                "evidence_reference": evidence_reference.strip(),
                "review_case_id": review_case_id,
            },
            actor_user_id=hr_user.id,
            actor_username=hr_user.username,
            station_id=station.id,
        )

    return result, None


def apply_attendance_correction(
    hr_user: User,
    session_id: int,
    correction_type: str,
    corrected_timestamp_utc: datetime,
    reason: str,
    evidence_ref: str = "HR-CORR-DOC",
) -> tuple[AttendanceCorrection | None, str | None]:
    """
    Apply an authorized HR correction to an attendance session (AT-23).
    CRITICAL REQUIREMENT (Section 1 & Section 5):
    - Requires a mandatory reason.
    - Preserves the original `AttendanceEvent` row in `attendance_events` without overwriting it.
    - Creates a new `MANUAL_HR` replacement event, links both in `AttendanceCorrection`,
      updates the session pointer, and creates an immutable `AuditLog` record.
    """
    if not reason or len(reason.strip()) < 5:
        return None, "Mandatory reason is required to correct an attendance record (AT-23)."

    corr_type = (correction_type or "").strip().upper()
    if corr_type not in {"CHECK_IN_TIME", "CHECK_OUT_TIME", "ADD_MISSING_CHECKOUT"}:
        return None, "Invalid correction_type. Use CHECK_IN_TIME, CHECK_OUT_TIME, or ADD_MISSING_CHECKOUT."

    with transactional_session() as db_sess:
        att_session = db_sess.get(AttendanceSession, session_id)
        if not att_session:
            return None, "Attendance session not found."

        if corr_type == "CHECK_IN_TIME":
            orig_event = att_session.check_in_event
            prev_ts = orig_event.occurred_at if orig_event else None
            station_id = orig_event.station_id if orig_event else None

            replacement_event = AttendanceEvent(
                session_id=att_session.id,
                employee_id=att_session.employee_id,
                event_type="CHECK_IN",
                occurred_at=corrected_timestamp_utc,
                station_id=station_id,
                capture_method="MANUAL_HR",
                recognition_score=None,
                recorded_by_user_id=hr_user.id,
                manual_reason=f"HR Correction: {reason.strip()}",
                evidence_ref=evidence_ref,
                created_at=utc_now(),
            )
            db_sess.add(replacement_event)
            db_sess.flush()

            # Preserve orig_event in attendance_events; repoint session to replacement_event
            att_session.check_in_event_id = replacement_event.id
            att_session.is_corrected = True
            grace_mins = (
                att_session.shift_assignment.shift_template.grace_period_minutes
                if (att_session.shift_assignment and att_session.shift_assignment.shift_template)
                else 15
            )
            status, late_mins = evaluate_arrival_punctuality(
                corrected_timestamp_utc, att_session.shift_start_at, grace_mins
            )
            att_session.arrival_status = status
            att_session.late_minutes = late_mins
            att_session.updated_at = utc_now()

        else:
            # CHECK_OUT_TIME or ADD_MISSING_CHECKOUT
            orig_event = att_session.check_out_event
            prev_ts = orig_event.occurred_at if orig_event else None
            station_id = (
                orig_event.station_id
                if orig_event
                else (att_session.check_in_event.station_id if att_session.check_in_event else None)
            )

            if att_session.check_in_event and corrected_timestamp_utc < att_session.check_in_event.occurred_at:
                return None, "Corrected Check-Out time cannot be earlier than the session's Check-In time."

            replacement_event = AttendanceEvent(
                session_id=att_session.id,
                employee_id=att_session.employee_id,
                event_type="CHECK_OUT",
                occurred_at=corrected_timestamp_utc,
                station_id=station_id,
                capture_method="MANUAL_HR",
                recognition_score=None,
                recorded_by_user_id=hr_user.id,
                manual_reason=f"HR Correction: {reason.strip()}",
                evidence_ref=evidence_ref,
                created_at=utc_now(),
            )
            db_sess.add(replacement_event)
            db_sess.flush()

            att_session.check_out_event_id = replacement_event.id
            att_session.status = "COMPLETED"
            att_session.is_corrected = True
            att_session.updated_at = utc_now()

        correction = AttendanceCorrection(
            session_id=att_session.id,
            original_event_id=orig_event.id if orig_event else None,
            replacement_event_id=replacement_event.id,
            correction_type=corr_type,
            previous_timestamp=prev_ts,
            corrected_timestamp=corrected_timestamp_utc,
            reason=reason.strip(),
            evidence_ref=evidence_ref,
            corrected_by_user_id=hr_user.id,
            created_at=utc_now(),
        )
        db_sess.add(correction)
        db_sess.flush()

        record_audit_log(
            action="ATTENDANCE_CORRECTED",
            target_type="ATTENDANCE_SESSION",
            target_id=att_session.id,
            reason=reason.strip(),
            details={
                "correction_id": correction.id,
                "correction_type": corr_type,
                "original_event_id": orig_event.id if orig_event else None,
                "replacement_event_id": replacement_event.id,
                "previous_timestamp": prev_ts.isoformat() if prev_ts else None,
                "corrected_timestamp": corrected_timestamp_utc.isoformat(),
                "evidence_ref": evidence_ref,
            },
            actor_user_id=hr_user.id,
            actor_username=hr_user.username,
        )

    return correction, None

