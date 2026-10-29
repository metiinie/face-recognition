"""
Configurable schedules for Regular Staff, Cleaning Staff, and Security Guards,
including overnight shifts spanning midnight (AT-17), 24-hour guard shifts (AT-18),
effective-dated schedule transitions (AT-19), holidays/leaves (AT-20), and
Ethiopian-clock to conventional EAT (UTC+3) conversion.
"""
from datetime import datetime, date, time, timedelta
from backend.database import db, transactional_session
from backend.database.models import (
    Employee,
    ShiftTemplate,
    ShiftAssignment,
    ScheduleException,
    utc_to_local,
    local_to_utc,
    utc_now,
)
from backend.audit.service import record_audit_log


def ethiopian_to_conventional_24h(eth_hour: int, eth_minute: int = 0, is_night_cycle: bool = False) -> str:
    """
    Convert Ethiopian 12-hour clock time to standard 24-hour East Africa Time (HH:MM).
    In Ethiopian time:
      Day cycle (Morning/Afternoon): 12:00 -> 06:00, 1:00 -> 07:00, 2:00 -> 08:00 ... 11:00 -> 17:00
      Night cycle (Evening/Night):   12:00 -> 18:00, 1:00 -> 19:00 ... 6:00 -> 00:00 ... 11:00 -> 05:00
    """
    h = eth_hour % 12
    conv_hour = (h + (18 if is_night_cycle else 6)) % 24
    return f"{conv_hour:02d}:{eth_minute:02d}"


def _parse_hhmm(hhmm: str) -> time:
    parts = hhmm.strip().split(":")
    return time(int(parts[0]), int(parts[1]))


def create_shift_template(
    name: str,
    job_category: str,
    start_time: str,
    end_time: str,
    grace_period_minutes: int = 15,
    spans_midnight: bool = False,
    is_24_hour: bool = False,
    break_rules: str = "60 min lunch break",
    hr_approved: bool = True,
    actor: str = "HR Admin",
) -> tuple[ShiftTemplate | None, str | None]:
    if not name or not start_time or not end_time:
        return None, "Shift name, start_time, and end_time are required."

    try:
        t_start = _parse_hhmm(start_time)
        t_end = _parse_hhmm(end_time)
    except Exception:
        return None, "Start and end times must be in HH:MM (24-hour) format."

    if ShiftTemplate.query.filter_by(name=name.strip()).first():
        return None, f"Shift template '{name.strip()}' already exists."

    if is_24_hour:
        spans_midnight = True
    elif t_end <= t_start and not is_24_hour:
        spans_midnight = True

    with transactional_session() as session:
        tmpl = ShiftTemplate(
            name=name.strip(),
            job_category=job_category.strip().upper(),
            start_time=f"{t_start.hour:02d}:{t_start.minute:02d}",
            end_time=f"{t_end.hour:02d}:{t_end.minute:02d}",
            spans_midnight=bool(spans_midnight),
            is_24_hour=bool(is_24_hour),
            break_rules=break_rules,
            grace_period_minutes=int(grace_period_minutes),
            hr_approved=bool(hr_approved),
            status="ACTIVE",
            created_at=utc_now(),
        )
        session.add(tmpl)
        session.flush()

        record_audit_log(
            action="SHIFT_TEMPLATE_CREATED",
            target_type="SHIFT_TEMPLATE",
            target_id=tmpl.id,
            details={
                "name": tmpl.name,
                "job_category": tmpl.job_category,
                "start_time": tmpl.start_time,
                "end_time": tmpl.end_time,
                "spans_midnight": tmpl.spans_midnight,
                "is_24_hour": tmpl.is_24_hour,
                "grace_period_minutes": tmpl.grace_period_minutes,
            },
            actor_username=actor,
        )

    return tmpl, None


def assign_shift_to_employee(
    employee_id: int,
    shift_template_id: int,
    effective_from: date,
    effective_to: date | None = None,
    working_days: str = "0,1,2,3,4",
    approved_by: str = "HR Admin",
) -> tuple[ShiftAssignment | None, str | None]:
    """
    Assign an effective-dated work schedule to an employee without rewriting prior
    attendance history (AT-19). Automatically closes any prior open-ended assignment
    the day before `effective_from`.
    """
    emp = db.session.get(Employee, employee_id)
    if not emp:
        return None, "Employee not found."

    tmpl = db.session.get(ShiftTemplate, shift_template_id)
    if not tmpl:
        return None, "Shift template not found."

    if not tmpl.hr_approved:
        return None, "Shift template must be approved by College HR before assignment."

    if effective_to and effective_to < effective_from:
        return None, "effective_to cannot be earlier than effective_from."

    with transactional_session() as session:
        # Close prior open-ended assignments starting before effective_from (AT-19)
        open_assignments = ShiftAssignment.query.filter(
            ShiftAssignment.employee_id == emp.id,
            ShiftAssignment.effective_to.is_(None),
            ShiftAssignment.effective_from < effective_from,
        ).all()
        for prev in open_assignments:
            prev.effective_to = effective_from - timedelta(days=1)

        assignment = ShiftAssignment(
            employee_id=emp.id,
            shift_template_id=tmpl.id,
            effective_from=effective_from,
            effective_to=effective_to,
            working_days=working_days.strip(),
            approved_by=approved_by,
            created_at=utc_now(),
        )
        session.add(assignment)
        session.flush()

        record_audit_log(
            action="SHIFT_ASSIGNED",
            target_type="EMPLOYEE",
            target_id=emp.employee_number,
            details={
                "assignment_id": assignment.id,
                "shift_template": tmpl.name,
                "effective_from": effective_from.isoformat(),
                "effective_to": effective_to.isoformat() if effective_to else None,
            },
            actor_username=approved_by,
        )

    return assignment, None


def get_effective_assignment_for_date(employee_id: int, target_date: date) -> ShiftAssignment | None:
    """
    Return the active ShiftAssignment for an employee on `target_date` (AT-19).
    """
    candidates = (
        ShiftAssignment.query.filter(
            ShiftAssignment.employee_id == employee_id,
            ShiftAssignment.effective_from <= target_date,
            db.or_(
                ShiftAssignment.effective_to.is_(None),
                ShiftAssignment.effective_to >= target_date,
            ),
        )
        .order_by(ShiftAssignment.effective_from.desc(), ShiftAssignment.id.desc())
        .all()
    )
    return candidates[0] if candidates else None


def _compute_utc_bounds_for_work_date(tmpl: ShiftTemplate, work_date: date) -> tuple[datetime, datetime]:
    """
    Given a ShiftTemplate and local calendar `work_date`, compute the exact UTC
    (shift_start_at, shift_end_at) timestamps, handling overnight shifts spanning midnight
    (AT-17) and 24-hour guard shifts (AT-18).
    """
    t_start = _parse_hhmm(tmpl.start_time)
    t_end = _parse_hhmm(tmpl.end_time)

    local_start = datetime.combine(work_date, t_start)
    if tmpl.is_24_hour:
        local_end = local_start + timedelta(hours=24)
    elif tmpl.spans_midnight or t_end <= t_start:
        local_end = datetime.combine(work_date + timedelta(days=1), t_end)
    else:
        local_end = datetime.combine(work_date, t_end)

    return local_to_utc(local_start), local_to_utc(local_end)


def resolve_shift_window_for_timestamp(
    employee_id: int,
    event_utc: datetime,
) -> tuple[ShiftAssignment | None, date, datetime, datetime]:
    """
    Resolve which logical work_date and shift window (shift_start_at, shift_end_at in UTC)
    apply to `event_utc`.
    Handles overnight shifts spanning midnight (AT-17) and 24-hour guard shifts (AT-18)
    by checking whether the timestamp belongs to yesterday's overnight shift first.
    """
    local_dt = utc_to_local(event_utc)
    local_date = local_dt.date()

    # Check if yesterday had an overnight or 24-hour shift still in progress
    yesterday = local_date - timedelta(days=1)
    prev_assign = get_effective_assignment_for_date(employee_id, yesterday)
    if prev_assign and prev_assign.shift_template:
        prev_tmpl = prev_assign.shift_template
        if prev_tmpl.spans_midnight or prev_tmpl.is_24_hour:
            p_start_utc, p_end_utc = _compute_utc_bounds_for_work_date(prev_tmpl, yesterday)
            # Allow up to 4 hours after shift end for late check-out association
            if p_start_utc - timedelta(hours=1) <= event_utc <= p_end_utc + timedelta(hours=4):
                return prev_assign, yesterday, p_start_utc, p_end_utc

    # Otherwise resolve for today's local date
    curr_assign = get_effective_assignment_for_date(employee_id, local_date)
    if curr_assign and curr_assign.shift_template:
        c_start_utc, c_end_utc = _compute_utc_bounds_for_work_date(curr_assign.shift_template, local_date)
        return curr_assign, local_date, c_start_utc, c_end_utc

    # Fallback default window (08:00 - 17:00 EAT) if no shift assignment exists
    default_start_local = datetime.combine(local_date, time(8, 0))
    default_end_local = datetime.combine(local_date, time(17, 0))
    return None, local_date, local_to_utc(default_start_local), local_to_utc(default_end_local)


def evaluate_arrival_punctuality(
    check_in_utc: datetime,
    shift_start_utc: datetime,
    grace_period_minutes: int = 15,
) -> tuple[str, int]:
    """
    Compare actual check-in UTC timestamp against shift_start_utc + grace_period_minutes.
    Returns (arrival_status: 'ON_TIME' | 'LATE', late_minutes: int) (AT-15, AT-16).
    """
    cutoff_utc = shift_start_utc + timedelta(minutes=max(0, int(grace_period_minutes)))
    if check_in_utc <= cutoff_utc:
        return "ON_TIME", 0
    delta_seconds = (check_in_utc - shift_start_utc).total_seconds()
    late_mins = max(1, int(round(delta_seconds / 60.0)))
    return "LATE", late_mins


def create_schedule_exception(
    title: str,
    exception_type: str,
    start_date: date,
    end_date: date,
    employee_id: int | None = None,
    reason: str | None = None,
    approved_by: str = "HR Admin",
) -> tuple[ScheduleException | None, str | None]:
    if not title or not start_date or not end_date:
        return None, "Title, start_date, and end_date are required."
    if end_date < start_date:
        return None, "end_date cannot be earlier than start_date."

    with transactional_session() as session:
        exc = ScheduleException(
            title=title.strip(),
            exception_type=exception_type.strip().upper(),
            employee_id=employee_id,
            start_date=start_date,
            end_date=end_date,
            reason=reason,
            approved_by=approved_by,
            created_at=utc_now(),
        )
        session.add(exc)
        session.flush()

        record_audit_log(
            action="SCHEDULE_EXCEPTION_CREATED",
            target_type="SCHEDULE_EXCEPTION",
            target_id=exc.id,
            reason=reason,
            details={
                "title": exc.title,
                "type": exc.exception_type,
                "employee_id": employee_id,
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
            },
            actor_username=approved_by,
        )

    return exc, None


def is_date_exempt_for_employee(employee_id: int, target_date: date) -> ScheduleException | None:
    """
    Check if a public holiday or approved employee leave applies on `target_date` (AT-20).
    """
    return (
        ScheduleException.query.filter(
            ScheduleException.start_date <= target_date,
            ScheduleException.end_date >= target_date,
            db.or_(
                ScheduleException.employee_id.is_(None),
                ScheduleException.employee_id == employee_id,
            ),
        )
        .order_by(ScheduleException.employee_id.desc())
        .first()
    )

