"""
Attendance Engine: validates explicit Check-In / Check-Out confirmations against
employee status, trusted station, assigned shift, and open attendance session.
Satisfies Section 1, Section 2 (Journeys A & B), Section 4 (attendance),
and Acceptance Tests AT-07 through AT-19, AT-24.
"""
from datetime import datetime, timedelta
from flask import current_app
from backend.database import db, transactional_session
from backend.database.models import (
    Employee,
    AttendanceStation,
    AttendanceSession,
    AttendanceEvent,
    utc_now,
)
from backend.shifts.service import (
    resolve_shift_window_for_timestamp,
    evaluate_arrival_punctuality,
)
from backend.audit.service import record_audit_log


def get_open_session_for_employee(employee_id: int) -> AttendanceSession | None:
    """Return the currently OPEN attendance session for an employee, if any."""
    return (
        AttendanceSession.query.filter_by(employee_id=employee_id, status="OPEN")
        .order_by(AttendanceSession.shift_start_at.desc(), AttendanceSession.id.desc())
        .first()
    )


def flag_overdue_open_sessions(reference_utc: datetime | None = None) -> int:
    """
    Flag open sessions whose shift ended more than 6 hours ago as INCOMPLETE_REVIEW.
    CRITICAL RULE (Section 1 & AT-14): Never invent a missing check-out time!
    """
    now_utc = reference_utc or utc_now()
    cutoff = now_utc - timedelta(hours=6)

    overdue_sessions = AttendanceSession.query.filter(
        AttendanceSession.status == "OPEN",
        AttendanceSession.shift_end_at < cutoff,
        AttendanceSession.check_out_event_id.is_(None),
    ).all()

    if not overdue_sessions:
        return 0

    with transactional_session():
        for sess in overdue_sessions:
            sess.status = "INCOMPLETE_REVIEW"
            sess.notes = (
                (sess.notes + " | ") if sess.notes else ""
            ) + "Flagged for HR review: missing check-out (no check-out time invented)."
            record_audit_log(
                action="SESSION_FLAGGED_INCOMPLETE",
                target_type="ATTENDANCE_SESSION",
                target_id=sess.id,
                reason="Missing check-out past shift cutoff; flagged for HR review without inventing check-out time (AT-14)",
                details={"employee_id": sess.employee_id, "work_date": sess.work_date.isoformat()},
            )

    return len(overdue_sessions)


def confirm_attendance_action(
    employee_id: int,
    station: AttendanceStation,
    event_type: str,
    recognition_score: float | None = 0.95,
    occurred_at: datetime | None = None,
    capture_method: str = "BIOMETRIC",
    recorded_by_user_id: int | None = None,
    manual_reason: str | None = None,
    evidence_ref: str | None = None,
    simulate_db_failure: bool = False,
) -> tuple[dict | None, str | None, str | None]:
    """
    Validate and record an explicit CHECK_IN or CHECK_OUT event transactionally.
    Returns (result_dict, error_code, error_message).
    Never silently changes event_type (Journey B, AT-10).
    """
    action = (event_type or "").strip().upper()
    if action not in {"CHECK_IN", "CHECK_OUT"}:
        return None, "INVALID_EVENT_TYPE", "Event type must be explicitly CHECK_IN or CHECK_OUT."

    event_time = occurred_at or utc_now()
    cooldown_sec = current_app.config.get("DUPLICATE_EVENT_COOLDOWN_SECONDS", 60)

    try:
        with transactional_session() as session:
            emp = session.get(Employee, employee_id)
            if not emp:
                return None, "EMPLOYEE_NOT_FOUND", "Employee record does not exist."

            if emp.status != "ACTIVE":
                # AT-07: Deactivated employee blocked from recording new attendance
                return (
                    None,
                    "EMPLOYEE_INACTIVE",
                    f"Employee {emp.employee_number} is INACTIVE. New attendance events are blocked.",
                )

            if not station or station.status != "ACTIVE":
                return None, "STATION_INACTIVE", "Attendance station is not active."

            # AT-11 & AT-12: Prevent rapid duplicate frames or double-click concurrent requests
            recent_cutoff = event_time - timedelta(seconds=cooldown_sec)
            recent_duplicate = (
                session.query(AttendanceEvent)
                .filter(
                    AttendanceEvent.employee_id == emp.id,
                    AttendanceEvent.event_type == action,
                    AttendanceEvent.occurred_at >= recent_cutoff,
                    AttendanceEvent.occurred_at <= event_time + timedelta(seconds=cooldown_sec),
                )
                .first()
            )
            if recent_duplicate:
                return (
                    None,
                    "DUPLICATE_EVENT_PREVENTED",
                    f"Duplicate {action} request prevented: an identical event was already recorded "
                    f"within the {cooldown_sec}-second protection window.",
                )

            # Query open session with row-level locking for concurrency protection on MySQL
            sess_query = (
                session.query(AttendanceSession)
                .filter_by(employee_id=emp.id, status="OPEN")
                .order_by(AttendanceSession.shift_start_at.desc(), AttendanceSession.id.desc())
            )
            bind = session.get_bind()
            if bind and bind.dialect.name == "mysql":
                sess_query = sess_query.with_for_update()
            open_sess = sess_query.first()

            if action == "CHECK_IN":
                # Check if employee already has an open session
                if open_sess is not None:
                    return (
                        None,
                        "SESSION_ALREADY_OPEN",
                        f"Cannot Check-In: {emp.full_name} already has an open attendance session "
                        f"(Session #{open_sess.id} for {open_sess.work_date}). "
                        "Please select Check-Out or request HR review if a prior check-out was missed.",
                    )

                assignment, work_date, shift_start_utc, shift_end_utc = resolve_shift_window_for_timestamp(
                    emp.id, event_time
                )

                # Prevent contradictory second session on the same shift start
                existing_same_shift = (
                    session.query(AttendanceSession)
                    .filter_by(
                        employee_id=emp.id,
                        work_date=work_date,
                        shift_start_at=shift_start_utc,
                    )
                    .filter(AttendanceSession.status.in_(["OPEN", "COMPLETED"]))
                    .first()
                )
                if existing_same_shift:
                    return (
                        None,
                        "SHIFT_SESSION_ALREADY_EXISTS",
                        f"An attendance session already exists for {emp.full_name} on shift {work_date}.",
                    )

                grace_mins = (
                    assignment.shift_template.grace_period_minutes
                    if (assignment and assignment.shift_template)
                    else 15
                )
                arrival_status, late_minutes = evaluate_arrival_punctuality(
                    event_time, shift_start_utc, grace_mins
                )

                new_sess = AttendanceSession(
                    employee_id=emp.id,
                    shift_assignment_id=assignment.id if assignment else None,
                    work_date=work_date,
                    shift_start_at=shift_start_utc,
                    shift_end_at=shift_end_utc,
                    arrival_status=arrival_status,
                    late_minutes=late_minutes,
                    status="OPEN",
                    created_at=utc_now(),
                    updated_at=utc_now(),
                )
                session.add(new_sess)
                session.flush()

                new_event = AttendanceEvent(
                    session_id=new_sess.id,
                    employee_id=emp.id,
                    event_type="CHECK_IN",
                    occurred_at=event_time,
                    station_id=station.id,
                    capture_method=capture_method,
                    recognition_score=recognition_score,
                    recorded_by_user_id=recorded_by_user_id,
                    manual_reason=manual_reason,
                    evidence_ref=evidence_ref,
                    created_at=utc_now(),
                )
                session.add(new_event)
                session.flush()

                new_sess.check_in_event_id = new_event.id

                if simulate_db_failure:
                    # AT-13: Trigger rollback to verify atomic transaction integrity
                    raise RuntimeError("Simulated database failure during event commit (AT-13)")

                return (
                    {
                        "session_id": new_sess.id,
                        "event_id": new_event.id,
                        "employee_id": emp.id,
                        "employee_number": emp.employee_number,
                        "employee_name": emp.full_name,
                        "event_type": "CHECK_IN",
                        "capture_method": capture_method,
                        "station_code": station.station_code,
                        "work_date": work_date.isoformat(),
                        "occurred_at_utc": event_time.isoformat(),
                        "shift_start_utc": shift_start_utc.isoformat(),
                        "shift_end_utc": shift_end_utc.isoformat(),
                        "arrival_status": arrival_status,
                        "late_minutes": late_minutes,
                        "session_status": new_sess.status,
                    },
                    None,
                    None,
                )

            else:
                # action == "CHECK_OUT" (Journey B, AT-09, AT-10)
                if open_sess is None:
                    return (
                        None,
                        "NO_OPEN_SESSION_FOR_CHECKOUT",
                        f"Cannot Check-Out: No open attendance session found for {emp.full_name}. "
                        "The system does not silently convert Check-Out to Check-In. "
                        "Please choose Check-In if starting your shift, or submit an HR Review Request.",
                    )

                if event_time < open_sess.check_in_event.occurred_at:
                    return (
                        None,
                        "CHECKOUT_BEFORE_CHECKIN",
                        "Check-Out timestamp cannot be earlier than the session's Check-In timestamp.",
                    )

                checkout_event = AttendanceEvent(
                    session_id=open_sess.id,
                    employee_id=emp.id,
                    event_type="CHECK_OUT",
                    occurred_at=event_time,
                    station_id=station.id,
                    capture_method=capture_method,
                    recognition_score=recognition_score,
                    recorded_by_user_id=recorded_by_user_id,
                    manual_reason=manual_reason,
                    evidence_ref=evidence_ref,
                    created_at=utc_now(),
                )
                session.add(checkout_event)
                session.flush()

                open_sess.check_out_event_id = checkout_event.id
                open_sess.status = "COMPLETED"
                open_sess.updated_at = utc_now()

                if simulate_db_failure:
                    # AT-13: Trigger rollback to verify atomic transaction integrity
                    raise RuntimeError("Simulated database failure during check-out commit (AT-13)")

                return (
                    {
                        "session_id": open_sess.id,
                        "event_id": checkout_event.id,
                        "employee_id": emp.id,
                        "employee_number": emp.employee_number,
                        "employee_name": emp.full_name,
                        "event_type": "CHECK_OUT",
                        "capture_method": capture_method,
                        "station_code": station.station_code,
                        "work_date": open_sess.work_date.isoformat(),
                        "occurred_at_utc": event_time.isoformat(),
                        "shift_start_utc": open_sess.shift_start_at.isoformat(),
                        "shift_end_utc": open_sess.shift_end_at.isoformat(),
                        "arrival_status": open_sess.arrival_status,
                        "late_minutes": open_sess.late_minutes,
                        "session_status": open_sess.status,
                    },
                    None,
                    None,
                )

    except Exception as exc:
        # AT-13: Database failure rolls back incomplete transaction and never reports false success
        return (
            None,
            "DATABASE_TRANSACTION_FAILURE",
            f"Database transaction failed and was safely rolled back. No attendance event was saved. ({str(exc)})",
        )

