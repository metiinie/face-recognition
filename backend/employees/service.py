"""
Employee profile, department assignment, job category, and active status management.
Satisfies Section 4 (employees), Section 5 (employees), and AT-01, AT-02, AT-07.
"""
from backend.database import db, transactional_session
from backend.database.models import (
    Department,
    Employee,
    FaceTemplate,
    ShiftAssignment,
    AttendanceEvent,
    AuditLog,
    utc_now,
)
from backend.audit.service import record_audit_log

VALID_JOB_CATEGORIES = {
    "REGULAR_STAFF",
    "ACADEMIC_LECTURER",
    "LAB_INSTRUCTOR",
    "ADMIN_STAFF",
    "RESEARCH_CANDIDATE",
    "CLEANING_STAFF",
    "SECURITY_GUARD",
}

VALID_UNIT_TYPES = {
    "ACADEMIC_FACULTY",
    "TECHNICAL_DEPT",
    "ADMIN_UNIT",
    "CAMPUS_OPERATIONS",
}


def compute_candidate_lifecycle(
    emp: Employee,
    active_template: FaceTemplate | None = None,
    active_assignment: ShiftAssignment | None = None,
    latest_event: AttendanceEvent | None = None,
    latest_verification_log: AuditLog | None = None,
) -> dict:
    """
    Compute the unified 5-stage candidate registration-to-identification lifecycle:
      1. REGISTERED
      2. CONSENT_VERIFIED
      3. BIOMETRIC_ENROLLED
      4. SCHEDULE_ASSIGNED
      5. VERIFIED_IDENTIFIED
    """
    is_active = emp.status == "ACTIVE"
    has_consent = bool(emp.consent_verified)
    has_template = active_template is not None
    has_schedule = active_assignment is not None
    has_identified = latest_event is not None or latest_verification_log is not None

    verified_at = None
    if latest_event and latest_event.occurred_at:
        verified_at = latest_event.occurred_at.isoformat()
    elif latest_verification_log and latest_verification_log.created_at:
        verified_at = latest_verification_log.created_at.isoformat()

    steps = [
        {
            "step": 1,
            "key": "REGISTERED",
            "label": "Candidate Registered",
            "completed": True,
            "timestamp": emp.created_at.isoformat() if emp.created_at else None,
        },
        {
            "step": 2,
            "key": "CONSENT_VERIFIED",
            "label": "Privacy Consent (POL-02)",
            "completed": has_consent,
            "timestamp": emp.updated_at.isoformat() if (has_consent and emp.updated_at) else None,
        },
        {
            "step": 3,
            "key": "BIOMETRIC_ENROLLED",
            "label": "Biometric Face Enrolled",
            "completed": has_template,
            "timestamp": active_template.enrolled_at.isoformat() if (active_template and active_template.enrolled_at) else None,
        },
        {
            "step": 4,
            "key": "SCHEDULE_ASSIGNED",
            "label": "Shift Assigned",
            "completed": has_schedule,
            "timestamp": active_assignment.effective_from.isoformat() if (active_assignment and active_assignment.effective_from) else None,
        },
        {
            "step": 5,
            "key": "VERIFIED_IDENTIFIED",
            "label": "Scan & ID Verified",
            "completed": has_identified,
            "timestamp": verified_at,
        },
    ]

    completed_count = sum(1 for s in steps if s["completed"])
    progress_pct = completed_count * 20

    if not is_active:
        current_stage = "INACTIVE"
        next_action = "Reactivate candidate profile to resume scanning"
    elif not has_consent:
        current_stage = "2_CONSENT_PENDING"
        next_action = "Verify Biometric Consent (POL-02)"
    elif not has_template:
        current_stage = "3_BIOMETRIC_PENDING"
        next_action = "Capture & Enroll Face Biometrics"
    elif not has_schedule:
        current_stage = "4_SCHEDULE_PENDING"
        next_action = "Assign Shift Schedule"
    elif not has_identified:
        current_stage = "5_IDENTIFICATION_PENDING"
        next_action = "Run Live Identification Verification"
    else:
        current_stage = "5_VERIFIED_IDENTIFIED"
        next_action = "Ready for Gate & Kiosk Identification"

    return {
        "current_stage": current_stage,
        "stage_number": completed_count,
        "progress_pct": progress_pct,
        "ready_for_scanning": bool(is_active and has_consent and has_template and has_schedule),
        "next_action": next_action,
        "steps": steps,
    }


def create_department(
    name: str,
    code: str,
    faculty_name: str = "Ethio-Italy Polytechnic College",
    unit_type: str = "TECHNICAL_DEPT",
    actor: str = "HR Admin",
) -> tuple[Department | None, str | None]:
    if not name or not code:
        return None, "Department name and code are required."
    code_clean = code.strip().upper()
    name_clean = name.strip()
    unit_clean = (unit_type or "TECHNICAL_DEPT").strip().upper()
    if unit_clean not in VALID_UNIT_TYPES:
        return None, f"Invalid unit type '{unit_clean}'. Allowed: {', '.join(sorted(VALID_UNIT_TYPES))}."

    if Department.query.filter(
        (Department.code == code_clean) | (Department.name == name_clean)
    ).first():
        return None, f"Department with code '{code_clean}' or name '{name_clean}' already exists."

    with transactional_session() as session:
        dept = Department(
            name=name_clean,
            code=code_clean,
            faculty_name=(faculty_name or "Ethio-Italy Polytechnic College").strip(),
            unit_type=unit_clean,
            status="ACTIVE",
        )
        session.add(dept)
        session.flush()
        record_audit_log(
            action="DEPARTMENT_CREATED",
            target_type="DEPARTMENT",
            target_id=dept.code,
            details={"name": dept.name, "faculty_name": dept.faculty_name, "unit_type": dept.unit_type},
            actor_username=actor,
        )
    return dept, None


def create_employee(
    employee_number: str,
    first_name: str,
    last_name: str,
    department_id: int,
    job_category: str = "REGULAR_STAFF",
    phone: str | None = None,
    consent_verified: bool = True,
    actor: str = "HR Officer",
) -> tuple[Employee | None, str | None]:
    """
    Register a new employee with unique employee_number check (AT-01, AT-02).
    """
    if not employee_number or not employee_number.strip():
        return None, "Employee number is required."
    if not first_name or not first_name.strip() or not last_name or not last_name.strip():
        return None, "First name and last name are required."

    emp_num = employee_number.strip().upper()
    existing = Employee.query.filter_by(employee_number=emp_num).first()
    if existing:
        # AT-02: Reject duplicate employee number with clear validation message
        return None, f"Duplicate employee number '{emp_num}': an employee with this ID is already registered."

    dept = db.session.get(Department, department_id)
    if not dept:
        return None, "Selected department does not exist."

    category = (job_category or "REGULAR_STAFF").strip().upper()
    if category not in VALID_JOB_CATEGORIES:
        return None, f"Invalid job category '{category}'. Allowed: {', '.join(sorted(VALID_JOB_CATEGORIES))}."

    with transactional_session() as session:
        emp = Employee(
            employee_number=emp_num,
            first_name=first_name.strip(),
            last_name=last_name.strip(),
            department_id=dept.id,
            job_category=category,
            phone=phone.strip() if phone else None,
            status="ACTIVE",
            consent_verified=bool(consent_verified),
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        session.add(emp)
        session.flush()

        record_audit_log(
            action="EMPLOYEE_REGISTERED",
            target_type="EMPLOYEE",
            target_id=emp.employee_number,
            details={
                "employee_id": emp.id,
                "full_name": emp.full_name,
                "department": dept.code,
                "job_category": emp.job_category,
            },
            actor_username=actor,
        )

    return emp, None


def update_employee(
    employee_id: int,
    first_name: str | None = None,
    last_name: str | None = None,
    department_id: int | None = None,
    job_category: str | None = None,
    phone: str | None = None,
    consent_verified: bool | None = None,
    actor: str = "HR Officer",
) -> tuple[Employee | None, str | None]:
    emp = db.session.get(Employee, employee_id)
    if not emp:
        return None, "Employee not found."

    with transactional_session():
        if first_name and first_name.strip():
            emp.first_name = first_name.strip()
        if last_name and last_name.strip():
            emp.last_name = last_name.strip()
        if department_id is not None:
            dept = db.session.get(Department, department_id)
            if not dept:
                return None, "Department not found."
            emp.department_id = dept.id
        if job_category:
            cat = job_category.strip().upper()
            if cat not in VALID_JOB_CATEGORIES:
                return None, f"Invalid job category '{cat}'."
            emp.job_category = cat
        if phone is not None:
            emp.phone = phone.strip()
        if consent_verified is not None:
            old_consent = emp.consent_verified
            emp.consent_verified = bool(consent_verified)
            # If consent was withdrawn, revoke any active face templates immediately
            if old_consent and not emp.consent_verified:
                for tmpl in emp.face_templates.filter_by(status="ACTIVE").all():
                    tmpl.status = "REVOKED"
                    tmpl.revoked_at = utc_now()
                    tmpl.revoke_reason = "Biometric consent withdrawn by employee"
                record_audit_log(
                    action="BIOMETRIC_CONSENT_WITHDRAWN",
                    target_type="EMPLOYEE",
                    target_id=emp.employee_number,
                    reason="Biometric consent withdrawn via HR update; active templates revoked",
                    details={"employee_id": emp.id},
                    actor_username=actor,
                )
        emp.updated_at = utc_now()

        record_audit_log(
            action="EMPLOYEE_UPDATED",
            target_type="EMPLOYEE",
            target_id=emp.employee_number,
            details={
                "full_name": emp.full_name,
                "department_id": emp.department_id,
                "job_category": emp.job_category,
                "consent_verified": emp.consent_verified,
            },
            actor_username=actor,
        )
    return emp, None


def set_employee_status(
    employee_id: int,
    new_status: str,
    reason: str = "HR status update",
    actor: str = "HR Officer",
) -> tuple[Employee | None, str | None]:
    """
    Activate or deactivate an employee while preserving all historical attendance sessions
    and events (AT-07).
    """
    emp = db.session.get(Employee, employee_id)
    if not emp:
        return None, "Employee not found."

    status_clean = (new_status or "").strip().upper()
    if status_clean not in {"ACTIVE", "INACTIVE"}:
        return None, "Status must be ACTIVE or INACTIVE."

    with transactional_session():
        old_status = emp.status
        emp.status = status_clean
        emp.updated_at = utc_now()

        record_audit_log(
            action=f"EMPLOYEE_{status_clean}",
            target_type="EMPLOYEE",
            target_id=emp.employee_number,
            reason=reason,
            details={"old_status": old_status, "new_status": status_clean},
            actor_username=actor,
        )

    return emp, None

