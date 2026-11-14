"""
End-to-End University Governance, RBAC Scoping, Candidate 5-Stage Lifecycle,
Scan Sequence Trace, and Quick-Enroll Overwrite Protection Tests.
"""
import pytest
from datetime import date
from backend import create_app
from backend.config import TestConfig
from backend.database import db
from backend.database.models import Employee, Department, ShiftTemplate


class GovernanceTestConfig(TestConfig):
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    TESTING = True
    ALLOW_CLIENT_EVENT_TIMESTAMPS = True


@pytest.fixture
def app():
    application = create_app(config_class=GovernanceTestConfig, seed_db=False)
    with application.app_context():
        from backend.database.seed import seed_initial_data
        seed_initial_data()
        yield application
        db.session.remove()


@pytest.fixture
def client(app):
    return app.test_client()


def _login_headers(client, username: str, password: str) -> dict:
    res = client.post("/api/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, f"Login failed for {username}: {res.get_json()}"
    token = res.get_json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_university_faculty_department_and_academic_lecturer_lifecycle(client, app):
    """
    Verify full 5-stage candidate pipeline:
      1. Create faculty department + register ACADEMIC_LECTURER (consent pending)
      2. Verify POL-02 biometric consent
      3. Enroll biometric face template
      4. Assign effective shift schedule
      5. Run commissioning verification scan -> stage 5 VERIFIED_IDENTIFIED
    """
    hr_headers = _login_headers(client, "hr_officer", "Hr@EIPC2026")

    # 1a. Create new academic faculty department
    dept_res = client.post(
        "/api/departments",
        json={
            "name": "Biomedical & Instrumentation Engineering",
            "code": "DEPT-BIO",
            "faculty_name": "Faculty of Engineering",
            "unit_type": "ACADEMIC_FACULTY",
        },
        headers=hr_headers,
    )
    assert dept_res.status_code == 201
    dept_body = dept_res.get_json()["department"]
    assert dept_body["faculty_name"] == "Faculty of Engineering"
    assert dept_body["unit_type"] == "ACADEMIC_FACULTY"

    # 1b. Register ACADEMIC_LECTURER initially without consent
    emp_res = client.post(
        "/api/employees",
        json={
            "employee_number": "EIPC-LEC-901",
            "first_name": "Dawit",
            "last_name": "Bekele",
            "department_id": dept_body["id"],
            "job_category": "ACADEMIC_LECTURER",
            "consent_verified": False,
        },
        headers=hr_headers,
    )
    assert emp_res.status_code == 201
    emp = emp_res.get_json()["employee"]
    emp_id = emp["id"]
    assert emp["job_category"] == "ACADEMIC_LECTURER"
    assert emp["lifecycle"]["stage_number"] == 1
    assert emp["lifecycle"]["current_stage"] == "2_CONSENT_PENDING"
    assert emp["lifecycle"]["ready_for_scanning"] is False

    # 2. Verify POL-02 consent
    upd_res = client.put(
        f"/api/employees/{emp_id}",
        json={"consent_verified": True},
        headers=hr_headers,
    )
    assert upd_res.status_code == 200
    lc_after_consent = client.get(f"/api/employees/{emp_id}/lifecycle", headers=hr_headers).get_json()["lifecycle"]
    assert lc_after_consent["stage_number"] == 2
    assert lc_after_consent["current_stage"] == "3_BIOMETRIC_PENDING"

    # 3. Enroll biometric face template
    enroll_res = client.post(
        "/api/face/enroll",
        json={
            "employee_id": emp_id,
            "biometric_signature": "FACE_SIG_EIPC-LEC-901",
            "consent_verified": True,
        },
        headers=hr_headers,
    )
    assert enroll_res.status_code == 200
    lc_after_enroll = client.get(f"/api/employees/{emp_id}/lifecycle", headers=hr_headers).get_json()["lifecycle"]
    assert lc_after_enroll["stage_number"] == 3
    assert lc_after_enroll["current_stage"] == "4_SCHEDULE_PENDING"

    # 4. Assign shift schedule
    with app.app_context():
        shift = ShiftTemplate.query.first()
        assert shift is not None
        shift_id = shift.id

    assign_res = client.post(
        "/api/shifts/assign",
        json={
            "employee_id": emp_id,
            "shift_template_id": shift_id,
            "effective_from": date.today().isoformat(),
            "working_days": "0,1,2,3,4",
        },
        headers=hr_headers,
    )
    assert assign_res.status_code in (200, 201)
    lc_after_shift = client.get(f"/api/employees/{emp_id}/lifecycle", headers=hr_headers).get_json()["lifecycle"]
    assert lc_after_shift["stage_number"] == 4
    assert lc_after_shift["current_stage"] == "5_IDENTIFICATION_PENDING"
    assert lc_after_shift["ready_for_scanning"] is True

    # 5. Verify identification scan (dry-run without attendance punch)
    verify_res = client.post(
        f"/api/employees/{emp_id}/verify-identification",
        json={"biometric_signature": "FACE_SIG_EIPC-LEC-901"},
        headers=hr_headers,
    )
    assert verify_res.status_code == 200
    v_body = verify_res.get_json()
    assert v_body["verified"] is True
    assert len(v_body["scan_sequence"]) == 5
    assert all(step["status"] == "PASSED" for step in v_body["scan_sequence"])
    assert v_body["lifecycle"]["stage_number"] == 5
    assert v_body["lifecycle"]["current_stage"] == "5_VERIFIED_IDENTIFIED"


def test_dept_head_scoping_and_rbac_boundaries(client, app):
    """
    DEPT_HEAD ('dean_ict') sees only DEPT-ICT employees and reports,
    cannot access other department lifecycles, and cannot register candidates.
    """
    hr_headers = _login_headers(client, "hr_officer", "Hr@EIPC2026")
    dept_res = client.post(
        "/api/departments",
        json={
            "name": "Mechanical Engineering Workshop",
            "code": "DEPT-MECH",
            "faculty_name": "Faculty of Engineering",
            "unit_type": "TECHNICAL_DEPT",
        },
        headers=hr_headers,
    )
    assert dept_res.status_code == 201
    mech_dept_id = dept_res.get_json()["department"]["id"]

    other_emp_res = client.post(
        "/api/employees",
        json={
            "employee_number": "EIPC-MECH-777",
            "first_name": "Hanna",
            "last_name": "Tadesse",
            "department_id": mech_dept_id,
            "job_category": "LAB_INSTRUCTOR",
            "consent_verified": True,
        },
        headers=hr_headers,
    )
    assert other_emp_res.status_code == 201
    other_emp_id = other_emp_res.get_json()["employee"]["id"]

    dean_login = client.post(
        "/api/auth/login",
        json={"username": "dean_ict", "password": "DeanPassword123!"},
    )
    assert dean_login.status_code == 200
    dean_user = dean_login.get_json()["user"]
    assert dean_user["role"] == "DEPT_HEAD"
    assert dean_user["department_code"] == "DEPT-ICT"
    dean_headers = {"Authorization": f"Bearer {dean_login.get_json()['access_token']}"}

    # Employees list scoped to dean's department (DEPT-ICT)
    emps_res = client.get("/api/employees", headers=dean_headers)
    assert emps_res.status_code == 200
    emps = emps_res.get_json()["employees"]
    assert len(emps) >= 1
    assert all(e["department_id"] == dean_user["department_id"] for e in emps)
    assert not any(e["employee_number"] == "EIPC-MECH-777" for e in emps)

    # Blocked from inspecting another department candidate's lifecycle
    cross_lc = client.get(f"/api/employees/{other_emp_id}/lifecycle", headers=dean_headers)
    assert cross_lc.status_code == 403

    # Blocked from creating employees directly (HR/Admin only)
    create_denied = client.post(
        "/api/employees",
        json={
            "employee_number": "EIPC-ICT-888",
            "first_name": "Unauthorized",
            "last_name": "Attempt",
            "department_id": dean_user["department_id"],
            "job_category": "REGULAR_STAFF",
        },
        headers=dean_headers,
    )
    assert create_denied.status_code == 403

    # Department summary & reports scoped to dean's department
    summary_res = client.get("/api/attendance/summary", headers=dean_headers)
    assert summary_res.status_code == 200
    dept_breakdown = summary_res.get_json()["department_breakdown"]
    assert len(dept_breakdown) == 1
    assert dept_breakdown[0]["department_code"] == "DEPT-ICT"


def test_face_recognize_scan_sequence_and_quick_enroll_overwrite_protection(client):
    """
    1. /api/face/recognize returns 5-stage scan_sequence on matched and rejected scans.
    2. /api/station/quick-enroll blocks unauthenticated overwrite of an existing template (403),
       while permitting authorized operator ('gate_op') re-enrollment.
    """
    # Matched scan against seeded employee
    match_res = client.post(
        "/api/face/recognize",
        json={"station_code": "ST-ICT-01", "biometric_signature": "FACE_SIG_EIPC-EMP-001"},
    )
    assert match_res.status_code == 200
    match_body = match_res.get_json()
    assert match_body["matched"] is True
    assert len(match_body["scan_sequence"]) == 5
    assert [s["status"] for s in match_body["scan_sequence"]] == ["PASSED"] * 5

    # Unknown face scan fails at stage 4 IDENTITY_CONSENT_MATCH
    miss_res = client.post(
        "/api/face/recognize",
        json={"station_code": "ST-ICT-01", "biometric_signature": "FACE_SIG_UNKNOWN_PERSON_999"},
    )
    assert miss_res.status_code == 200
    miss_body = miss_res.get_json()
    assert miss_body["matched"] is False
    seq_by_step = {s["step"]: s for s in miss_body["scan_sequence"]}
    assert seq_by_step[1]["status"] == "PASSED"
    assert seq_by_step[4]["status"] == "FAILED"
    assert seq_by_step[5]["status"] == "SKIPPED"

    # Unauthenticated quick-enroll attempt overwriting an already-enrolled employee is blocked
    unauth_overwrite = client.post(
        "/api/station/quick-enroll",
        json={
            "employee_id": 1,
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
        },
    )
    assert unauth_overwrite.status_code == 403
    assert unauth_overwrite.get_json()["code"] == "TEMPLATE_OVERWRITE_FORBIDDEN"

    # Authorized Gate Operator ('gate_op') CAN perform controlled re-enrollment
    op_headers = _login_headers(client, "gate_op", "GatePassword123!")
    auth_overwrite = client.post(
        "/api/station/quick-enroll",
        json={
            "employee_id": 1,
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
        },
        headers=op_headers,
    )
    assert auth_overwrite.status_code == 200
    assert auth_overwrite.get_json()["status"] == "ENROLLED"
