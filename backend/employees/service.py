"""
Employee profile, department assignment, job category, and active status management.
Satisfies Section 4 (employees), Section 5 (employees), and AT-01, AT-02, AT-07.
"""
from backend.database import db, transactional_session
from backend.database.models import Department, Employee, utc_now
from backend.audit.service import record_audit_log

VALID_JOB_CATEGORIES = {"REGULAR_STAFF", "CLEANING_STAFF", "SECURITY_GUARD"}


def create_department(name: str, code: str, actor: str = "HR Admin") -> tuple[Department | None, str | None]:
    if not name or not code:
        return None, "Department name and code are required."
    code_clean = code.strip().upper()
    name_clean = name.strip()

    if Department.query.filter(
        (Department.code == code_clean) | (Department.name == name_clean)
    ).first():
        return None, f"Department with code '{code_clean}' or name '{name_clean}' already exists."

    with transactional_session() as session:
        dept = Department(name=name_clean, code=code_clean, status="ACTIVE")
        session.add(dept)
        session.flush()
        record_audit_log(
            action="DEPARTMENT_CREATED",
            target_type="DEPARTMENT",
            target_id=dept.code,
            details={"name": dept.name},
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
        emp.updated_at = utc_now()

        record_audit_log(
            action="EMPLOYEE_UPDATED",
            target_type="EMPLOYEE",
            target_id=emp.employee_number,
            details={
                "full_name": emp.full_name,
                "department_id": emp.department_id,
                "job_category": emp.job_category,
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

