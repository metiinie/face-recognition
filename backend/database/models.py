"""
SQLAlchemy ORM Models for the Face Recognition-Based Attendance Management System.
Follows Section 5 (Database schema and relationships) of the Implementation Blueprint.
All event instants are stored in UTC (naive UTC datetime in DB) and rendered in
Ethio-Italy Polytechnic College local time (EAT / UTC+3) plus Ethiopian Clock format.
"""
from datetime import datetime, timezone, timedelta
from backend.database import db

EAT_OFFSET = timedelta(hours=3)


def utc_now() -> datetime:
    """Return current UTC timestamp (naive UTC for consistent MySQL/SQLite storage)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_to_local(dt: datetime | None) -> datetime | None:
    """Convert naive UTC datetime to Dire Dawa local time (UTC+3)."""
    if dt is None:
        return None
    return dt + EAT_OFFSET


def local_to_utc(dt: datetime | None) -> datetime | None:
    """Convert Dire Dawa local time (UTC+3) to naive UTC datetime."""
    if dt is None:
        return None
    return dt - EAT_OFFSET


def format_ethiopian_clock_from_24h(hour: int, minute: int) -> str:
    """
    Convert standard 24-hour local time (EAT) to Ethiopian 12-hour clock representation.
    In Ethiopian time, 06:00 EAT is 12:00 (Day/Morning start), 07:00 EAT is 1:00 Day,
    18:00 EAT is 12:00 Evening, 19:00 EAT is 1:00 Night.
    """
    eth_hour = (hour - 6) % 12
    if eth_hour == 0:
        eth_hour = 12
    if 6 <= hour < 12:
        period = "Morning (ጥዋት)"
    elif 12 <= hour < 18:
        period = "Afternoon (ቀን)"
    elif 18 <= hour < 24:
        period = "Evening (ምሽት)"
    else:
        period = "Night (ሌሊት)"
    return f"{eth_hour:02d}:{minute:02d} {period}"


class Role(db.Model):
    __tablename__ = "roles"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)  # ADMIN, HR_OFFICER, AUDITOR
    description = db.Column(db.String(255), nullable=True)
    permissions_csv = db.Column(db.Text, nullable=False, default="")

    users = db.relationship("User", back_populates="role", lazy="dynamic")

    def has_permission(self, perm: str) -> bool:
        if self.name == "ADMIN":
            return True
        perms = {p.strip() for p in (self.permissions_csv or "").split(",") if p.strip()}
        return perm in perms or "*" in perms


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    full_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role_id = db.Column(db.Integer, db.ForeignKey("roles.id"), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="ACTIVE")  # ACTIVE, INACTIVE
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    last_login_at = db.Column(db.DateTime, nullable=True)

    role = db.relationship("Role", back_populates="users")

    def has_permission(self, perm: str) -> bool:
        if self.status != "ACTIVE" or not self.role:
            return False
        return self.role.has_permission(perm)


class Department(db.Model):
    __tablename__ = "departments"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), unique=True, nullable=False)
    code = db.Column(db.String(30), unique=True, nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False, default="ACTIVE")
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    employees = db.relationship("Employee", back_populates="department", lazy="dynamic")
    stations = db.relationship("AttendanceStation", back_populates="department", lazy="dynamic")


class Employee(db.Model):
    __tablename__ = "employees"

    id = db.Column(db.Integer, primary_key=True)
    employee_number = db.Column(db.String(40), unique=True, nullable=False, index=True)
    first_name = db.Column(db.String(80), nullable=False)
    last_name = db.Column(db.String(80), nullable=False)
    department_id = db.Column(db.Integer, db.ForeignKey("departments.id"), nullable=False)
    # REGULAR_STAFF, CLEANING_STAFF, SECURITY_GUARD
    job_category = db.Column(db.String(40), nullable=False, default="REGULAR_STAFF")
    phone = db.Column(db.String(40), nullable=True)
    status = db.Column(db.String(20), nullable=False, default="ACTIVE")  # ACTIVE, INACTIVE
    consent_verified = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    department = db.relationship("Department", back_populates="employees")
    face_templates = db.relationship(
        "FaceTemplate", back_populates="employee", lazy="dynamic", cascade="all, delete-orphan"
    )
    shift_assignments = db.relationship(
        "ShiftAssignment", back_populates="employee", lazy="dynamic"
    )
    attendance_sessions = db.relationship(
        "AttendanceSession", back_populates="employee", lazy="dynamic"
    )
    attendance_events = db.relationship(
        "AttendanceEvent", back_populates="employee", lazy="dynamic"
    )

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

    @property
    def active_template(self):
        return self.face_templates.filter_by(status="ACTIVE").order_by(FaceTemplate.enrolled_at.desc()).first()


class FaceTemplate(db.Model):
    __tablename__ = "face_templates"

    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id"), nullable=False, index=True)
    # Encrypted biometric vector payload (Fernet AES-128-CBC + HMAC)
    template_data = db.Column(db.Text, nullable=False)
    model_name = db.Column(db.String(80), nullable=False, default="EIPC-ArcFace-Embedder")
    model_version = db.Column(db.String(40), nullable=False, default="1.0.0")
    quality_score = db.Column(db.Float, nullable=False, default=0.95)
    status = db.Column(db.String(20), nullable=False, default="ACTIVE")  # ACTIVE, REPLACED, REVOKED
    enrolled_by = db.Column(db.String(80), nullable=True)
    enrolled_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    revoked_at = db.Column(db.DateTime, nullable=True)
    revoke_reason = db.Column(db.String(255), nullable=True)

    employee = db.relationship("Employee", back_populates="face_templates")


class AttendanceStation(db.Model):
    __tablename__ = "attendance_stations"

    id = db.Column(db.Integer, primary_key=True)
    station_code = db.Column(db.String(40), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    department_id = db.Column(db.Integer, db.ForeignKey("departments.id"), nullable=False)
    location = db.Column(db.String(160), nullable=False)
    # Trusted secret token required from kiosk browser/device (AT-24)
    station_secret_token = db.Column(db.String(128), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="ACTIVE")  # ACTIVE, MAINTENANCE, INACTIVE
    camera_status = db.Column(db.String(30), nullable=False, default="ONLINE")
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    department = db.relationship("Department", back_populates="stations")
    events = db.relationship("AttendanceEvent", back_populates="station", lazy="dynamic")


class ShiftTemplate(db.Model):
    __tablename__ = "shift_templates"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    # REGULAR_STAFF, CLEANING_STAFF, SECURITY_GUARD
    job_category = db.Column(db.String(40), nullable=False, default="REGULAR_STAFF")
    start_time = db.Column(db.String(5), nullable=False)  # "HH:MM" in 24h local time
    end_time = db.Column(db.String(5), nullable=False)    # "HH:MM" in 24h local time
    spans_midnight = db.Column(db.Boolean, nullable=False, default=False)
    is_24_hour = db.Column(db.Boolean, nullable=False, default=False)
    break_rules = db.Column(db.String(255), nullable=True, default="60 min lunch break")
    grace_period_minutes = db.Column(db.Integer, nullable=False, default=15)
    early_checkin_window_minutes = db.Column(db.Integer, nullable=False, default=90)
    hr_approved = db.Column(db.Boolean, nullable=False, default=True)
    status = db.Column(db.String(20), nullable=False, default="ACTIVE")
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    assignments = db.relationship("ShiftAssignment", back_populates="shift_template", lazy="dynamic")

    @property
    def ethiopian_time_display(self) -> str:
        try:
            sh, sm = [int(x) for x in self.start_time.split(":")]
            eh, em = [int(x) for x in self.end_time.split(":")]
            return f"{format_ethiopian_clock_from_24h(sh, sm)} → {format_ethiopian_clock_from_24h(eh, em)}"
        except Exception:
            return f"{self.start_time} - {self.end_time}"


class ShiftAssignment(db.Model):
    __tablename__ = "shift_assignments"

    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id"), nullable=False, index=True)
    shift_template_id = db.Column(db.Integer, db.ForeignKey("shift_templates.id"), nullable=False)
    effective_from = db.Column(db.Date, nullable=False, index=True)
    effective_to = db.Column(db.Date, nullable=True, index=True)  # NULL means open-ended
    # Comma-separated weekday numbers (0=Mon..6=Sun) e.g. "0,1,2,3,4"
    working_days = db.Column(db.String(40), nullable=False, default="0,1,2,3,4")
    approved_by = db.Column(db.String(80), nullable=False, default="HR Admin")
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    employee = db.relationship("Employee", back_populates="shift_assignments")
    shift_template = db.relationship("ShiftTemplate", back_populates="assignments")


class ScheduleException(db.Model):
    """Holidays and approved employee leaves (AT-20)."""
    __tablename__ = "schedule_exceptions"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(120), nullable=False)
    # PUBLIC_HOLIDAY or APPROVED_LEAVE
    exception_type = db.Column(db.String(30), nullable=False, default="PUBLIC_HOLIDAY")
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id"), nullable=True, index=True)
    start_date = db.Column(db.Date, nullable=False, index=True)
    end_date = db.Column(db.Date, nullable=False, index=True)
    reason = db.Column(db.String(255), nullable=True)
    approved_by = db.Column(db.String(80), nullable=False, default="HR Office")
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    employee = db.relationship("Employee")


class AttendanceSession(db.Model):
    __tablename__ = "attendance_sessions"

    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id"), nullable=False, index=True)
    shift_assignment_id = db.Column(db.Integer, db.ForeignKey("shift_assignments.id"), nullable=True)
    work_date = db.Column(db.Date, nullable=False, index=True)
    # Scheduled shift boundaries stored in UTC
    shift_start_at = db.Column(db.DateTime, nullable=False)
    shift_end_at = db.Column(db.DateTime, nullable=False)
    check_in_event_id = db.Column(db.Integer, db.ForeignKey("attendance_events.id", use_alter=True), nullable=True)
    check_out_event_id = db.Column(db.Integer, db.ForeignKey("attendance_events.id", use_alter=True), nullable=True)
    # ON_TIME, LATE
    arrival_status = db.Column(db.String(20), nullable=False, default="ON_TIME")
    late_minutes = db.Column(db.Integer, nullable=False, default=0)
    # OPEN, COMPLETED, INCOMPLETE_REVIEW
    status = db.Column(db.String(30), nullable=False, default="OPEN", index=True)
    is_corrected = db.Column(db.Boolean, nullable=False, default=False)
    notes = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    employee = db.relationship("Employee", back_populates="attendance_sessions")
    shift_assignment = db.relationship("ShiftAssignment")
    check_in_event = db.relationship("AttendanceEvent", foreign_keys=[check_in_event_id], post_update=True)
    check_out_event = db.relationship("AttendanceEvent", foreign_keys=[check_out_event_id], post_update=True)
    events = db.relationship(
        "AttendanceEvent",
        primaryjoin="AttendanceSession.id == AttendanceEvent.session_id",
        back_populates="session",
        lazy="dynamic",
    )
    corrections = db.relationship("AttendanceCorrection", back_populates="session", lazy="dynamic")


class AttendanceEvent(db.Model):
    __tablename__ = "attendance_events"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("attendance_sessions.id"), nullable=True, index=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id"), nullable=False, index=True)
    # CHECK_IN, CHECK_OUT
    event_type = db.Column(db.String(20), nullable=False)
    occurred_at = db.Column(db.DateTime, nullable=False, default=utc_now, index=True)
    station_id = db.Column(db.Integer, db.ForeignKey("attendance_stations.id"), nullable=True)
    # BIOMETRIC, MANUAL_HR
    capture_method = db.Column(db.String(20), nullable=False, default="BIOMETRIC")
    recognition_score = db.Column(db.Float, nullable=True)
    recorded_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    manual_reason = db.Column(db.String(255), nullable=True)
    evidence_ref = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    session = db.relationship(
        "AttendanceSession",
        foreign_keys=[session_id],
        back_populates="events",
    )
    employee = db.relationship("Employee", back_populates="attendance_events")
    station = db.relationship("AttendanceStation", back_populates="events")
    recorded_by = db.relationship("User")


class ReviewCase(db.Model):
    """
    Tracks unknown-face retries, failed recognitions, missing check-out escalations,
    and invalid action assistance requests for HR review (Journey B & C).
    """
    __tablename__ = "review_cases"

    id = db.Column(db.Integer, primary_key=True)
    station_id = db.Column(db.Integer, db.ForeignKey("attendance_stations.id"), nullable=True)
    candidate_employee_id = db.Column(db.Integer, db.ForeignKey("employees.id"), nullable=True)
    claimed_employee_number = db.Column(db.String(40), nullable=True)
    # UNKNOWN_FACE, LOW_QUALITY_IMAGE, INVALID_CHECKOUT_ATTEMPT, MISSING_CHECKOUT, EMPLOYEE_DISPUTE
    case_type = db.Column(db.String(40), nullable=False, default="UNKNOWN_FACE")
    intended_action = db.Column(db.String(20), nullable=True)  # CHECK_IN or CHECK_OUT
    reason = db.Column(db.Text, nullable=False)
    recognition_score = db.Column(db.Float, nullable=True)
    # OPEN, APPROVED_MANUAL_ENTRY, REJECTED, RESOLVED
    status = db.Column(db.String(30), nullable=False, default="OPEN", index=True)
    resolution_notes = db.Column(db.Text, nullable=True)
    evidence_reference = db.Column(db.String(120), nullable=True)
    resolved_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    resolved_event_id = db.Column(db.Integer, db.ForeignKey("attendance_events.id"), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    resolved_at = db.Column(db.DateTime, nullable=True)

    station = db.relationship("AttendanceStation")
    candidate_employee = db.relationship("Employee")
    resolved_by = db.relationship("User")
    resolved_event = db.relationship("AttendanceEvent")


class AttendanceCorrection(db.Model):
    """
    Preserves immutable original attendance_events while recording authorized HR corrections
    with mandatory reasons (Section 1 & 5, AT-23).
    """
    __tablename__ = "attendance_corrections"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("attendance_sessions.id"), nullable=False, index=True)
    original_event_id = db.Column(db.Integer, db.ForeignKey("attendance_events.id"), nullable=True)
    replacement_event_id = db.Column(db.Integer, db.ForeignKey("attendance_events.id"), nullable=True)
    correction_type = db.Column(db.String(40), nullable=False)  # CHECK_IN_TIME, CHECK_OUT_TIME, ADD_MISSING_CHECKOUT
    previous_timestamp = db.Column(db.DateTime, nullable=True)
    corrected_timestamp = db.Column(db.DateTime, nullable=False)
    reason = db.Column(db.Text, nullable=False)
    evidence_ref = db.Column(db.String(120), nullable=True)
    corrected_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    session = db.relationship("AttendanceSession", back_populates="corrections")
    original_event = db.relationship("AttendanceEvent", foreign_keys=[original_event_id])
    replacement_event = db.relationship("AttendanceEvent", foreign_keys=[replacement_event_id])
    corrected_by = db.relationship("User")


class AuditLog(db.Model):
    """
    Append-only audit history for all sensitive HR and Administrator operations.
    """
    __tablename__ = "audit_logs"

    id = db.Column(db.Integer, primary_key=True)
    actor_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True, index=True)
    actor_username = db.Column(db.String(80), nullable=False, default="SYSTEM")
    action = db.Column(db.String(80), nullable=False, index=True)
    target_type = db.Column(db.String(60), nullable=False)
    target_id = db.Column(db.String(60), nullable=True)
    reason = db.Column(db.Text, nullable=True)
    details_json = db.Column(db.Text, nullable=True)
    station_id = db.Column(db.Integer, nullable=True)
    ip_address = db.Column(db.String(60), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now, index=True)


class PolicySignoff(db.Model):
    """
    Tracks Section 8 operational policy areas requiring confirmation before college-wide rollout.
    """
    __tablename__ = "policy_signoffs"

    id = db.Column(db.Integer, primary_key=True)
    policy_code = db.Column(db.String(50), unique=True, nullable=False)
    title = db.Column(db.String(140), nullable=False)
    description = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(30), nullable=False, default="PENDING_CONFIRMATION")  # CONFIRMED, PENDING_CONFIRMATION
    decision_notes = db.Column(db.Text, nullable=True)
    confirmed_by = db.Column(db.String(80), nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)

