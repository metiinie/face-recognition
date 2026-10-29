"""
Database Seeding Service for Ethio-Italy Polytechnic College, Dire Dawa.
Populates realistic initial departments, roles, users, shift templates (regular, cleaning,
overnight guard, 24-hour guard), departmental stations, enrolled employees, sample sessions,
and Section 8 operational policy sign-off items.
"""
from datetime import date, datetime, time, timedelta
from backend.database import db
from backend.database.models import (
    Role,
    User,
    Department,
    Employee,
    AttendanceStation,
    ShiftTemplate,
    ShiftAssignment,
    ScheduleException,
    AttendanceSession,
    AttendanceEvent,
    ReviewCase,
    PolicySignoff,
    local_to_utc,
    utc_now,
)
from backend.auth.service import hash_password
from backend.face_enrollment.service import enroll_employee_face


def seed_initial_data():
    """Seed college baseline data if roles table is empty."""
    if Role.query.first() is not None:
        return

    # 1. Roles & Permissions
    admin_role = Role(
        name="ADMIN",
        description="System Administrator with full access to users, stations, security, and audit.",
        permissions_csv="*",
    )
    hr_role = Role(
        name="HR_OFFICER",
        description="College HR Officer authorized for employee management, enrollment, schedules, reviews, corrections, and reports.",
        permissions_csv="employees.manage,enrollment.manage,schedules.manage,attendance.review,attendance.correct,reports.view,reports.export,audit.view",
    )
    auditor_role = Role(
        name="AUDITOR",
        description="Read-only Auditor for attendance reports and audit logs.",
        permissions_csv="reports.view,audit.view",
    )
    db.session.add_all([admin_role, hr_role, auditor_role])
    db.session.flush()

    # 2. Users
    admin_user = User(
        username="admin",
        full_name="Ato Dawit Tadesse (System Admin)",
        email="admin@eipc-diredawa.edu.et",
        password_hash=hash_password("Admin@EIPC2026"),
        role_id=admin_role.id,
        status="ACTIVE",
    )
    hr_user = User(
        username="hr_officer",
        full_name="W/ro Tigist Bekele (Senior HR Officer)",
        email="hr@eipc-diredawa.edu.et",
        password_hash=hash_password("Hr@EIPC2026"),
        role_id=hr_role.id,
        status="ACTIVE",
    )
    auditor_user = User(
        username="auditor",
        full_name="AtoSolomon Girma (Internal Auditor)",
        email="audit@eipc-diredawa.edu.et",
        password_hash=hash_password("Audit@EIPC2026"),
        role_id=auditor_role.id,
        status="ACTIVE",
    )
    db.session.add_all([admin_user, hr_user, auditor_user])
    db.session.flush()

    # 3. College Departments
    dept_ict = Department(name="ICT & Software Engineering", code="DEPT-ICT", status="ACTIVE")
    dept_auto = Department(name="Automotive & Electro-Mechanical", code="DEPT-AUTO", status="ACTIVE")
    dept_civil = Department(name="Garment, Textile & Civil Works", code="DEPT-CIVIL", status="ACTIVE")
    dept_sec = Department(name="Campus Security & Sanitation", code="DEPT-SEC", status="ACTIVE")
    db.session.add_all([dept_ict, dept_auto, dept_civil, dept_sec])
    db.session.flush()

    # 4. Departmental Attendance Stations (with trusted station secret tokens)
    st_ict = AttendanceStation(
        station_code="ST-ICT-01",
        name="ICT Building Ground Floor Kiosk",
        department_id=dept_ict.id,
        location="Block A - ICT Lab Wing Entrance",
        station_secret_token="trusted-token-st-ict-01",
        status="ACTIVE",
        camera_status="ONLINE",
    )
    st_auto = AttendanceStation(
        station_code="ST-AUTO-01",
        name="Automotive Workshop Station",
        department_id=dept_auto.id,
        location="Workshop Hall B - Main Bay",
        station_secret_token="trusted-token-st-auto-01",
        status="ACTIVE",
        camera_status="ONLINE",
    )
    st_civil = AttendanceStation(
        station_code="ST-CIVIL-01",
        name="Civil & Textile Block Station",
        department_id=dept_civil.id,
        location="Block C - Staff Lounge Entrance",
        station_secret_token="trusted-token-st-civil-01",
        status="ACTIVE",
        camera_status="ONLINE",
    )
    st_sec = AttendanceStation(
        station_code="ST-GATE-01",
        name="Main Gate Security & Facilities Station",
        department_id=dept_sec.id,
        location="Main Campus Gate House",
        station_secret_token="trusted-token-st-gate-01",
        status="ACTIVE",
        camera_status="ONLINE",
    )
    db.session.add_all([st_ict, st_auto, st_civil, st_sec])
    db.session.flush()

    # 5. Configurable Shift Templates (Regular, Cleaning, Overnight Guard, 24h Guard)
    shift_regular = ShiftTemplate(
        name="Regular Academic & Admin Shift (08:00-17:00)",
        job_category="REGULAR_STAFF",
        start_time="08:00",
        end_time="17:00",
        spans_midnight=False,
        is_24_hour=False,
        break_rules="12:00-13:00 (6:00-7:00 Eth) Lunch Break",
        grace_period_minutes=15,
        hr_approved=True,
        status="ACTIVE",
    )
    shift_cleaning = ShiftTemplate(
        name="Early Morning Sanitation Shift (06:30-15:00)",
        job_category="CLEANING_STAFF",
        start_time="06:30",
        end_time="15:00",
        spans_midnight=False,
        is_24_hour=False,
        break_rules="11:30-12:15 Morning Rest Break",
        grace_period_minutes=10,
        hr_approved=True,
        status="ACTIVE",
    )
    shift_guard_night = ShiftTemplate(
        name="Overnight Security Shift (20:00-06:00+1d)",
        job_category="SECURITY_GUARD",
        start_time="20:00",
        end_time="06:00",
        spans_midnight=True,
        is_24_hour=False,
        break_rules="On-duty rotational patrol relief",
        grace_period_minutes=10,
        hr_approved=True,
        status="ACTIVE",
    )
    shift_guard_24h = ShiftTemplate(
        name="24-Hour Security Guard Shift (07:00-07:00+1d)",
        job_category="SECURITY_GUARD",
        start_time="07:00",
        end_time="07:00",
        spans_midnight=True,
        is_24_hour=True,
        break_rules="Scheduled rest periods in guard quarters",
        grace_period_minutes=15,
        hr_approved=True,
        status="ACTIVE",
    )
    db.session.add_all([shift_regular, shift_cleaning, shift_guard_night, shift_guard_24h])
    db.session.flush()

    # 6. Employees
    emp1 = Employee(
        employee_number="EIPC-EMP-001",
        first_name="Abebe",
        last_name="Kebede",
        department_id=dept_ict.id,
        job_category="REGULAR_STAFF",
        phone="+251-915-321001",
        status="ACTIVE",
        consent_verified=True,
    )
    emp2 = Employee(
        employee_number="EIPC-EMP-002",
        first_name="Hanna",
        last_name="Mekonnen",
        department_id=dept_auto.id,
        job_category="REGULAR_STAFF",
        phone="+251-915-321002",
        status="ACTIVE",
        consent_verified=True,
    )
    emp3 = Employee(
        employee_number="EIPC-EMP-003",
        first_name="Chaltu",
        last_name="Girma",
        department_id=dept_sec.id,
        job_category="CLEANING_STAFF",
        phone="+251-915-321003",
        status="ACTIVE",
        consent_verified=True,
    )
    emp4 = Employee(
        employee_number="EIPC-EMP-004",
        first_name="Kebede",
        last_name="Alemu",
        department_id=dept_sec.id,
        job_category="SECURITY_GUARD",
        phone="+251-915-321004",
        status="ACTIVE",
        consent_verified=True,
    )
    emp5 = Employee(
        employee_number="EIPC-EMP-005",
        first_name="Yonas",
        last_name="Hailu",
        department_id=dept_sec.id,
        job_category="SECURITY_GUARD",
        phone="+251-915-321005",
        status="ACTIVE",
        consent_verified=True,
    )
    db.session.add_all([emp1, emp2, emp3, emp4, emp5])
    db.session.flush()

    # 7. Effective-dated Shift Assignments
    eff_start = date(2026, 1, 1)
    db.session.add_all([
        ShiftAssignment(
            employee_id=emp1.id,
            shift_template_id=shift_regular.id,
            effective_from=eff_start,
            working_days="0,1,2,3,4",
            approved_by=hr_user.username,
        ),
        ShiftAssignment(
            employee_id=emp2.id,
            shift_template_id=shift_regular.id,
            effective_from=eff_start,
            working_days="0,1,2,3,4",
            approved_by=hr_user.username,
        ),
        ShiftAssignment(
            employee_id=emp3.id,
            shift_template_id=shift_cleaning.id,
            effective_from=eff_start,
            working_days="0,1,2,3,4,5",
            approved_by=hr_user.username,
        ),
        ShiftAssignment(
            employee_id=emp4.id,
            shift_template_id=shift_guard_night.id,
            effective_from=eff_start,
            working_days="0,1,2,3,4,5,6",
            approved_by=hr_user.username,
        ),
        ShiftAssignment(
            employee_id=emp5.id,
            shift_template_id=shift_guard_24h.id,
            effective_from=eff_start,
            working_days="0,1,2,3,4,5,6",
            approved_by=hr_user.username,
        ),
    ])
    db.session.commit()

    # 8. Enroll face templates using encrypted storage
    for emp in [emp1, emp2, emp3, emp4, emp5]:
        enroll_employee_face(
            employee_id=emp.id,
            capture_payload={
                "biometric_signature": f"FACE_SIG_{emp.employee_number}",
                "quality_metrics": {"brightness": 135.0, "sharpness": 92.0, "face_detected": True},
            },
            enrolled_by=hr_user.username,
        )

    # 9. Sample Attendance Sessions & Open Review Case for Today
    today_local = (utc_now() + timedelta(hours=3)).date()
    sa1 = ShiftAssignment.query.filter_by(employee_id=emp1.id).first()
    sa2 = ShiftAssignment.query.filter_by(employee_id=emp2.id).first()

    # Emp 1: On-time check-in (currently OPEN session)
    s1_start = local_to_utc(datetime.combine(today_local, time(8, 0)))
    s1_end = local_to_utc(datetime.combine(today_local, time(17, 0)))
    s1_ci_time = local_to_utc(datetime.combine(today_local, time(7, 54)))

    sess1 = AttendanceSession(
        employee_id=emp1.id,
        shift_assignment_id=sa1.id,
        work_date=today_local,
        shift_start_at=s1_start,
        shift_end_at=s1_end,
        arrival_status="ON_TIME",
        late_minutes=0,
        status="OPEN",
    )
    db.session.add(sess1)
    db.session.flush()
    ev1 = AttendanceEvent(
        session_id=sess1.id,
        employee_id=emp1.id,
        event_type="CHECK_IN",
        occurred_at=s1_ci_time,
        station_id=st_ict.id,
        capture_method="BIOMETRIC",
        recognition_score=0.964,
    )
    db.session.add(ev1)
    db.session.flush()
    sess1.check_in_event_id = ev1.id

    # Emp 2: Late check-in (08:28 EAT -> 28 mins late)
    s2_ci_time = local_to_utc(datetime.combine(today_local, time(8, 28)))
    sess2 = AttendanceSession(
        employee_id=emp2.id,
        shift_assignment_id=sa2.id,
        work_date=today_local,
        shift_start_at=s1_start,
        shift_end_at=s1_end,
        arrival_status="LATE",
        late_minutes=28,
        status="OPEN",
    )
    db.session.add(sess2)
    db.session.flush()
    ev2 = AttendanceEvent(
        session_id=sess2.id,
        employee_id=emp2.id,
        event_type="CHECK_IN",
        occurred_at=s2_ci_time,
        station_id=st_auto.id,
        capture_method="BIOMETRIC",
        recognition_score=0.931,
    )
    db.session.add(ev2)
    db.session.flush()
    sess2.check_in_event_id = ev2.id

    # Sample Open Review Case (Journey C)
    rc1 = ReviewCase(
        station_id=st_civil.id,
        claimed_employee_number="EIPC-EMP-003",
        case_type="UNKNOWN_FACE",
        intended_action="CHECK_IN",
        reason="Employee requested HR assistance after camera glare rejected 2 scan attempts at Block C.",
        recognition_score=0.54,
        status="OPEN",
    )
    db.session.add(rc1)

    # Sample Public Holiday exception
    db.session.add(
        ScheduleException(
            title="Ethiopian Epiphany / Timket Public Holiday",
            exception_type="PUBLIC_HOLIDAY",
            employee_id=None,
            start_date=date(2026, 1, 19),
            end_date=date(2026, 1, 19),
            reason="National Public Holiday",
            approved_by=hr_user.username,
        )
    )

    # 10. Section 8 Operational Policy Sign-off Checklist
    policies = [
        PolicySignoff(
            policy_code="POL-01-SCHEDULE-CONV",
            title="College Schedule & Ethiopian-Clock Conversion Rules",
            description="Confirm Ethiopian-clock times, equivalent conventional (EAT UTC+3) times, workdays, breaks, and grace periods with College HR.",
            status="CONFIRMED",
            decision_notes="Dual Ethiopian & 24h EAT display enabled; 15-min regular and 10-min sanitation/guard grace periods configured.",
            confirmed_by="W/ro Tigist Bekele (HR)",
        ),
        PolicySignoff(
            policy_code="POL-02-BIOMETRIC-PRIVACY",
            title="Biometric Privacy, Encryption & Retention Policy",
            description="Approve employee notice/consent, Fernet AES encryption at rest, retention periods, access restrictions, and template revocation procedures.",
            status="CONFIRMED",
            decision_notes="Fernet AES-128-CBC + HMAC encryption at rest active; consent check enforced before enrollment.",
            confirmed_by="Ato Dawit Tadesse (Admin)",
        ),
        PolicySignoff(
            policy_code="POL-03-MANUAL-DISPUTES",
            title="Manual Attendance Entry & Dispute Resolution Workflow",
            description="Define physical ID verification, HR Officer approval authority, mandatory reasons, evidence reference, and non-destructive corrections.",
            status="CONFIRMED",
            decision_notes="Manual entries tagged MANUAL_HR with mandatory reason & evidence; original events preserved on correction.",
            confirmed_by="W/ro Tigist Bekele (HR)",
        ),
        PolicySignoff(
            policy_code="POL-04-ANTI-SPOOFING",
            title="Anti-Spoofing & Liveness Evaluation Scope",
            description="Decide whether active/passive liveness detection is required for pilot and define how spoofing risk is mitigated at supervised departmental stations.",
            status="PENDING_CONFIRMATION",
            decision_notes="Version 1 explicitly treats face recognition as identity candidate + explicit confirmation; liveness evaluation scheduled for pilot review.",
            confirmed_by=None,
        ),
        PolicySignoff(
            policy_code="POL-05-STATION-HARDWARE",
            title="Departmental Station Hardware & Network Deployment",
            description="Confirm camera/PC placement, lighting stability, network connectivity to central MySQL server, and trusted station token provisioning.",
            status="PENDING_CONFIRMATION",
            decision_notes="4 departmental stations registered with trusted tokens; pilot lighting & latency benchmark ready to run.",
            confirmed_by=None,
        ),
    ]
    db.session.add_all(policies)
    db.session.commit()

