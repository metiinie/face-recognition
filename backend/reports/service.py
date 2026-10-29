"""
Attendance reporting, multi-criteria filtering, absence evaluation respecting holidays/leaves (AT-20),
and CSV export distinguishing biometric events from manual entries (AT-25).
"""
import csv
import io
from datetime import date
from backend.database import db
from backend.database.models import (
    Employee,
    Department,
    AttendanceSession,
    AttendanceEvent,
    ReviewCase,
    utc_to_local,
)
from backend.shifts.service import (
    get_effective_assignment_for_date,
    is_date_exempt_for_employee,
)
from backend.audit.service import record_audit_log


def query_attendance_sessions(
    department_id: int | None = None,
    employee_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    status: str | None = None,
    arrival_status: str | None = None,
    capture_method: str | None = None,
) -> list[AttendanceSession]:
    """
    Filter attendance sessions by department, employee, date range, session status,
    arrival status, and capture method (Screen 3 & Screen 4).
    """
    q = AttendanceSession.query.join(Employee, AttendanceSession.employee_id == Employee.id)

    if department_id:
        q = q.filter(Employee.department_id == int(department_id))
    if employee_id:
        q = q.filter(AttendanceSession.employee_id == int(employee_id))
    if date_from:
        q = q.filter(AttendanceSession.work_date >= date_from)
    if date_to:
        q = q.filter(AttendanceSession.work_date <= date_to)
    if status:
        q = q.filter(AttendanceSession.status == status.strip().upper())
    if arrival_status:
        q = q.filter(AttendanceSession.arrival_status == arrival_status.strip().upper())
    if capture_method:
        cm = capture_method.strip().upper()
        q = q.join(
            AttendanceEvent,
            AttendanceSession.check_in_event_id == AttendanceEvent.id,
        ).filter(AttendanceEvent.capture_method == cm)

    return q.order_by(AttendanceSession.work_date.desc(), AttendanceSession.id.desc()).all()


def evaluate_employee_daily_status(employee_id: int, target_date: date) -> dict:
    """
    Evaluate an employee's attendance status on `target_date`, respecting public holidays,
    approved leaves (AT-20), and assigned working days.
    """
    emp = db.session.get(Employee, employee_id)
    if not emp:
        return {"status": "UNKNOWN", "reason": "Employee not found"}

    # Check if employee has a recorded session on target_date
    sess = AttendanceSession.query.filter_by(
        employee_id=emp.id, work_date=target_date
    ).first()
    if sess:
        return {
            "status": "PRESENT",
            "arrival_status": sess.arrival_status,
            "late_minutes": sess.late_minutes,
            "session_status": sess.status,
            "session_id": sess.id,
        }

    # Check if an approved holiday or leave applies (AT-20)
    exc = is_date_exempt_for_employee(emp.id, target_date)
    if exc:
        return {
            "status": "EXEMPT_HOLIDAY_OR_LEAVE",
            "exception_type": exc.exception_type,
            "title": exc.title,
            "reason": exc.reason or exc.title,
        }

    # Check if employee is scheduled to work on this weekday
    assignment = get_effective_assignment_for_date(emp.id, target_date)
    if not assignment:
        return {"status": "UNSCHEDULED", "reason": "No active shift assignment"}

    working_days = {
        int(x.strip())
        for x in (assignment.working_days or "").split(",")
        if x.strip().isdigit()
    }
    if target_date.weekday() not in working_days:
        return {"status": "REST_DAY", "reason": "Scheduled non-working day"}

    return {
        "status": "ABSENT",
        "shift_name": assignment.shift_template.name if assignment.shift_template else "Assigned Shift",
    }


def get_hr_dashboard_summary(
    target_date: date | None = None,
    department_id: int | None = None,
    employee_id: int | None = None,
) -> dict:
    """
    Compute HR Dashboard metrics (Screen 3):
      - Today's check-ins and check-outs
      - On-time and late arrivals
      - Open sessions and missing check-outs
      - Unrecognized-face review queue
    """
    sessions = query_attendance_sessions(
        department_id=department_id,
        employee_id=employee_id,
        date_from=target_date,
        date_to=target_date,
    )

    total_checkins = sum(1 for s in sessions if s.check_in_event_id is not None)
    total_checkouts = sum(1 for s in sessions if s.check_out_event_id is not None)
    on_time_count = sum(1 for s in sessions if s.arrival_status == "ON_TIME")
    late_count = sum(1 for s in sessions if s.arrival_status == "LATE")
    open_sessions_count = sum(1 for s in sessions if s.status == "OPEN")
    incomplete_review_count = sum(1 for s in sessions if s.status == "INCOMPLETE_REVIEW")
    manual_entries_count = sum(
        1
        for s in sessions
        if (s.check_in_event and s.check_in_event.capture_method == "MANUAL_HR")
        or (s.check_out_event and s.check_out_event.capture_method == "MANUAL_HR")
    )

    open_reviews = ReviewCase.query.filter_by(status="OPEN").order_by(ReviewCase.created_at.desc()).all()

    return {
        "total_sessions": len(sessions),
        "total_checkins": total_checkins,
        "total_checkouts": total_checkouts,
        "on_time_count": on_time_count,
        "late_count": late_count,
        "open_sessions_count": open_sessions_count,
        "incomplete_review_count": incomplete_review_count,
        "manual_entries_count": manual_entries_count,
        "open_review_cases_count": len(open_reviews),
        "sessions": sessions,
        "open_review_cases": open_reviews,
    }


def export_sessions_to_csv(
    sessions: list[AttendanceSession],
    actor_username: str = "HR Officer",
    filters_applied: dict | None = None,
) -> str:
    """
    Export filtered attendance sessions to CSV format while clearly distinguishing
    BIOMETRIC verification from MANUAL_HR entries and HR Corrections (Screen 4, AT-25).
    """
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Session ID",
        "Work Date",
        "Employee Number",
        "Employee Name",
        "Department",
        "Job Category",
        "Shift Template",
        "Scheduled Start (Local EAT)",
        "Scheduled End (Local EAT)",
        "Check-In Time (Local EAT)",
        "Check-In Capture Method",
        "Check-In Station",
        "Check-Out Time (Local EAT)",
        "Check-Out Capture Method",
        "Check-Out Station",
        "Arrival Status",
        "Late Minutes",
        "Session Status",
        "HR Corrected",
    ])

    for s in sessions:
        emp = s.employee
        dept_code = emp.department.code if (emp and emp.department) else ""
        shift_name = (
            s.shift_assignment.shift_template.name
            if (s.shift_assignment and s.shift_assignment.shift_template)
            else "Standard"
        )
        ci = s.check_in_event
        co = s.check_out_event

        ci_local = utc_to_local(ci.occurred_at).strftime("%Y-%m-%d %H:%M:%S") if ci else ""
        co_local = utc_to_local(co.occurred_at).strftime("%Y-%m-%d %H:%M:%S") if co else ""
        sched_start = utc_to_local(s.shift_start_at).strftime("%Y-%m-%d %H:%M") if s.shift_start_at else ""
        sched_end = utc_to_local(s.shift_end_at).strftime("%Y-%m-%d %H:%M") if s.shift_end_at else ""

        writer.writerow([
            s.id,
            s.work_date.isoformat(),
            emp.employee_number if emp else "",
            emp.full_name if emp else "",
            dept_code,
            emp.job_category if emp else "",
            shift_name,
            sched_start,
            sched_end,
            ci_local,
            ci.capture_method if ci else "NONE",
            ci.station.station_code if (ci and ci.station) else "",
            co_local,
            co.capture_method if co else "MISSING",
            co.station.station_code if (co and co.station) else "",
            s.arrival_status,
            s.late_minutes,
            s.status,
            "YES" if s.is_corrected else "NO",
        ])

    record_audit_log(
        action="ATTENDANCE_CSV_EXPORTED",
        target_type="REPORT",
        target_id=f"rows:{len(sessions)}",
        details=filters_applied or {"exported_rows": len(sessions)},
        actor_username=actor_username,
        commit=True,
    )

    return output.getvalue()

