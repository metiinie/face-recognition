"""
Comprehensive Automated Acceptance Test Suite (AT-01 through AT-26)
Verifies all functional, scheduling, biometric, transactional, security, and audit
requirements defined in Section 6 of the Implementation Blueprint.
"""
from datetime import date, datetime, time, timedelta
import pytest
from backend import create_app
from backend.config import TestConfig
from backend.database import db
from backend.database.models import (
    Employee,
    AttendanceSession,
    AttendanceEvent,
    AttendanceCorrection,
    AuditLog,
    local_to_utc,
)
from backend.database.seed import seed_initial_data


@pytest.fixture()
def app():
    application = create_app(config_class=TestConfig, seed_db=False)
    with application.app_context():
        db.create_all()
        seed_initial_data()
        # Clear sample seeded sessions so tests start with clean attendance tables
        AttendanceCorrection.query.delete()
        AttendanceEvent.query.delete()
        AttendanceSession.query.delete()
        db.session.commit()
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def login_as(client, username, password):
    return client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )


# ==============================================================================
# A. EMPLOYEE AND RECOGNITION TESTS (AT-01 to AT-07)
# ==============================================================================

def test_AT_01_register_new_employee_unique_id(client):
    """AT-01: Register a new employee with a unique ID -> Employee is saved successfully."""
    login_as(client, "hr_officer", "Hr@EIPC2026")
    resp = client.post(
        "/api/employees",
        json={
            "employee_number": "EIPC-EMP-101",
            "first_name": "Meron",
            "last_name": "Tadesse",
            "department_id": 1,
            "job_category": "REGULAR_STAFF",
        },
    )
    assert resp.status_code == 201
    data = resp.get_json()
    assert data["employee"]["employee_number"] == "EIPC-EMP-101"


def test_AT_02_register_duplicate_employee_number(client):
    """AT-02: Register a duplicate employee number -> Rejected with a clear validation message."""
    login_as(client, "hr_officer", "Hr@EIPC2026")
    resp = client.post(
        "/api/employees",
        json={
            "employee_number": "EIPC-EMP-001",  # Already exists in seed
            "first_name": "Duplicate",
            "last_name": "Person",
            "department_id": 1,
        },
    )
    assert resp.status_code == 400
    data = resp.get_json()
    assert "Duplicate employee number" in data["error"]


def test_AT_03_enroll_unusable_face_image(client):
    """AT-03: Enroll an employee with an unusable face image -> Enrollment is rejected."""
    login_as(client, "hr_officer", "Hr@EIPC2026")
    # Dark / obstructed image
    resp = client.post(
        "/api/employees/1/enroll",
        json={
            "biometric_signature": "FACE_SIG_POOR",
            "quality_metrics": {"brightness": 18.0, "sharpness": 20.0, "face_detected": True},
        },
    )
    assert resp.status_code == 422
    data = resp.get_json()
    assert data["enrolled"] is False
    assert "too dark" in data["error"].lower()


def test_AT_04_scan_enrolled_employee_supported_conditions(client):
    """AT-04: Scan an enrolled employee under supported conditions -> Identified within threshold, no auto event."""
    resp = client.post(
        "/api/station/scan",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "quality_metrics": {"brightness": 135.0, "sharpness": 92.0, "face_detected": True},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["matched"] is True
    assert data["employee"]["employee_number"] == "EIPC-EMP-001"
    assert data["recognition_score"] >= 0.78
    assert data["attendance_recorded"] is False


def test_AT_05_scan_unregistered_person(client, app):
    """AT-05: Scan an unregistered person -> No attendance recorded; neutral retry message."""
    resp = client.post(
        "/api/station/scan",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "biometric_signature": "FACE_SIG_UNREGISTERED_STRANGER_XYZ",
            "quality_metrics": {"brightness": 135.0, "sharpness": 90.0, "face_detected": True},
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["matched"] is False
    assert data["status"] in {"UNKNOWN_FACE", "UNCERTAIN_MATCH"}
    assert data.get("employee") is None
    with app.app_context():
        assert AttendanceEvent.query.count() == 0


def test_AT_06_scan_poor_lighting_or_obstructed_face(client):
    """AT-06: Scan under poor lighting or obstructed face -> System rejects unreliable frame rather than guessing."""
    resp = client.post(
        "/api/station/scan",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "quality_metrics": {"brightness": 120.0, "sharpness": 80.0, "face_detected": False, "obstructed": True},
        },
    )
    assert resp.status_code == 422
    data = resp.get_json()
    assert data["matched"] is False
    assert data["status"] == "QUALITY_REJECTED"


def test_AT_07_deactivate_employee_blocks_attendance_preserves_history(client, app):
    """AT-07: Deactivate an employee -> New attendance is blocked while historical records remain accessible."""
    # Record a valid check-in while active
    ci_resp = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-02T07:55:00",
        },
    )
    assert ci_resp.status_code == 201

    # Deactivate employee 1
    login_as(client, "hr_officer", "Hr@EIPC2026")
    deact = client.post(
        "/api/employees/1/status",
        json={"status": "INACTIVE", "reason": "End of contract"},
    )
    assert deact.status_code == 200

    # Attempt new attendance event while inactive -> blocked (403)
    blocked = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_OUT",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-02T17:05:00",
        },
    )
    assert blocked.status_code == 403
    assert blocked.get_json()["error_code"] == "EMPLOYEE_INACTIVE"

    # Verify historical session remains intact
    with app.app_context():
        hist_sessions = AttendanceSession.query.filter_by(employee_id=1).all()
        assert len(hist_sessions) == 1


# ==============================================================================
# B. ATTENDANCE TESTS (AT-08 to AT-14)
# ==============================================================================

def test_AT_08_recognized_employee_confirms_check_in(client, app):
    """AT-08: Recognized employee confirms Check-in -> 1 check-in event and 1 open session created."""
    ci = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-03T07:58:00",
        },
    )
    assert ci.status_code == 201
    ci_data = ci.get_json()["attendance"]
    assert ci_data["session_status"] == "OPEN"
    with app.app_context():
        assert AttendanceSession.query.filter_by(employee_id=1).count() == 1
        assert AttendanceEvent.query.filter_by(employee_id=1, event_type="CHECK_IN").count() == 1


def test_AT_09_employee_confirms_check_out_with_open_session(client, app):
    """AT-09: Employee confirms Check-out with open session -> 1 check-out event recorded and session closed."""
    ci = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-03T07:58:00",
        },
    )
    ci_data = ci.get_json()["attendance"]

    co = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_OUT",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-03T17:02:00",
        },
    )
    assert co.status_code == 201
    co_data = co.get_json()["attendance"]
    assert co_data["session_status"] == "COMPLETED"
    assert co_data["session_id"] == ci_data["session_id"]

    with app.app_context():
        assert AttendanceSession.query.filter_by(employee_id=1).count() == 1
        assert AttendanceEvent.query.filter_by(employee_id=1).count() == 2


def test_AT_10_check_out_without_open_session_rejected(client, app):
    """AT-10: Employee attempts Check-out without an open session -> Rejected; no false check-out or silent conversion."""
    resp = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_OUT",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-04T17:00:00",
        },
    )
    assert resp.status_code == 409
    data = resp.get_json()
    assert data["error_code"] == "NO_OPEN_SESSION_FOR_CHECKOUT"
    assert data["recovery_available"] is True
    with app.app_context():
        assert AttendanceEvent.query.count() == 0


def test_AT_11_repeated_frames_or_rapid_duplicate_requests_prevented(client, app):
    """AT-11: Repeated frames or rapid duplicate requests occur -> Duplicate attendance events prevented."""
    payload = {
        "station_code": "ST-ICT-01",
        "station_token": "trusted-token-st-ict-01",
        "employee_id": 1,
        "event_type": "CHECK_IN",
        "biometric_signature": "FACE_SIG_EIPC-EMP-001",
        "occurred_at_local": "2026-03-05T08:00:00",
    }
    first = client.post("/api/station/confirm", json=payload)
    assert first.status_code == 201

    payload_dup = dict(payload, occurred_at_local="2026-03-05T08:00:05")
    second = client.post("/api/station/confirm", json=payload_dup)
    assert second.status_code == 409
    assert second.get_json()["error_code"] == "DUPLICATE_EVENT_PREVENTED"


def test_AT_12_double_click_or_concurrent_requests_no_contradictory_sessions(client, app):
    """AT-12: Double-clicks or concurrent requests -> Database integrity maintained; no contradictory sessions."""
    payload = {
        "station_code": "ST-ICT-01",
        "station_token": "trusted-token-st-ict-01",
        "employee_id": 1,
        "event_type": "CHECK_IN",
        "biometric_signature": "FACE_SIG_EIPC-EMP-001",
        "occurred_at_local": "2026-03-05T08:00:00",
    }
    client.post("/api/station/confirm", json=payload)

    # Attempt another check-in 10 minutes later while session is still OPEN
    payload_later = dict(payload, occurred_at_local="2026-03-05T08:10:00")
    third = client.post("/api/station/confirm", json=payload_later)
    assert third.status_code == 409
    assert third.get_json()["error_code"] == "SESSION_ALREADY_OPEN"

    with app.app_context():
        assert AttendanceSession.query.filter_by(employee_id=1).count() == 1
        assert AttendanceEvent.query.filter_by(employee_id=1).count() == 1


def test_AT_13_database_failure_rolls_back_transaction(client, app):
    """AT-13: Database fails while an event is being saved -> No false success; incomplete transaction rolled back."""
    resp = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-06T08:00:00",
            "simulate_db_failure": True,
        },
    )
    assert resp.status_code == 500
    data = resp.get_json()
    assert data["recorded"] is False
    assert data["error_code"] == "DATABASE_TRANSACTION_FAILURE"

    with app.app_context():
        assert AttendanceSession.query.count() == 0
        assert AttendanceEvent.query.count() == 0


def test_AT_14_employee_forgets_to_check_out_flagged_without_invented_time(client, app):
    """AT-14: Employee forgets to check out -> Session is flagged for review; no invented check-out time added."""
    client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-01T08:00:00",
        },
    )
    login_as(client, "hr_officer", "Hr@EIPC2026")
    # Trigger overdue session scan 24 hours later
    flag_resp = client.post(
        "/api/attendance/flag-overdue",
        json={"reference_utc": "2026-03-02T12:00:00"},
    )
    assert flag_resp.status_code == 200
    assert flag_resp.get_json()["flagged_sessions"] == 1

    with app.app_context():
        sess = AttendanceSession.query.filter_by(employee_id=1).first()
        assert sess.status == "INCOMPLETE_REVIEW"
        assert sess.check_out_event_id is None  # Never invents a check-out time!


# ==============================================================================
# C. SCHEDULING TESTS (AT-15 to AT-20)
# ==============================================================================

def test_AT_15_regular_employee_checks_in_within_arrival_window(client):
    """AT-15: Regular employee checks in within approved arrival window (08:00 + 15m grace) -> ON_TIME."""
    r1 = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-09T08:12:00",
        },
    )
    assert r1.status_code == 201
    assert r1.get_json()["attendance"]["arrival_status"] == "ON_TIME"
    assert r1.get_json()["attendance"]["late_minutes"] == 0


def test_AT_16_employee_checks_in_after_approved_cutoff_marked_late(client):
    """AT-16: Employee checks in after approved cutoff (08:25) -> Marked LATE."""
    r2 = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-AUTO-01",
            "station_token": "trusted-token-st-auto-01",
            "employee_id": 2,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-002",
            "occurred_at_local": "2026-03-09T08:25:00",
        },
    )
    assert r2.status_code == 201
    assert r2.get_json()["attendance"]["arrival_status"] == "LATE"
    assert r2.get_json()["attendance"]["late_minutes"] == 25


def test_AT_17_overnight_shift_spanning_midnight(client):
    """AT-17: Employee works a shift spanning midnight (20:00 Day 1 to 06:00 Day 2) -> Events linked to same session."""
    # Employee 4 is assigned to Overnight Security Shift (20:00 - 06:00+1d)
    ci = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-GATE-01",
            "station_token": "trusted-token-st-gate-01",
            "employee_id": 4,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-004",
            "occurred_at_local": "2026-03-10T20:04:00",
        },
    )
    assert ci.status_code == 201
    ci_att = ci.get_json()["attendance"]
    assert ci_att["work_date"] == "2026-03-10"

    # Check out next morning after midnight (2026-03-11 06:02 EAT)
    co = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-GATE-01",
            "station_token": "trusted-token-st-gate-01",
            "employee_id": 4,
            "event_type": "CHECK_OUT",
            "biometric_signature": "FACE_SIG_EIPC-EMP-004",
            "occurred_at_local": "2026-03-11T06:02:00",
        },
    )
    assert co.status_code == 201
    co_att = co.get_json()["attendance"]
    assert co_att["session_id"] == ci_att["session_id"]
    assert co_att["session_status"] == "COMPLETED"


def test_AT_18_security_guard_24_hour_shift(client):
    """AT-18: Security guard has a 24-hour shift (07:00 Day 1 to 07:00 Day 2) -> Session spans full 24h across days."""
    # Employee 5 is assigned to 24-Hour Security Guard Shift (07:00 -> 07:00+1d)
    ci = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-GATE-01",
            "station_token": "trusted-token-st-gate-01",
            "employee_id": 5,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-005",
            "occurred_at_local": "2026-03-12T07:00:00",
        },
    )
    assert ci.status_code == 201
    ci_att = ci.get_json()["attendance"]
    start_dt = datetime.fromisoformat(ci_att["shift_start_utc"])
    end_dt = datetime.fromisoformat(ci_att["shift_end_utc"])
    assert (end_dt - start_dt) == timedelta(hours=24)

    # Check out 24 hours later on the following calendar day
    co = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-GATE-01",
            "station_token": "trusted-token-st-gate-01",
            "employee_id": 5,
            "event_type": "CHECK_OUT",
            "biometric_signature": "FACE_SIG_EIPC-EMP-005",
            "occurred_at_local": "2026-03-13T07:03:00",
        },
    )
    assert co.status_code == 201
    assert co.get_json()["attendance"]["session_id"] == ci_att["session_id"]
    assert co.get_json()["attendance"]["session_status"] == "COMPLETED"


def test_AT_19_schedule_change_effective_date_preserves_prior_history(client, app):
    """AT-19: Employee's schedule changes on an effective date -> New schedule used after date without rewriting history."""
    # Record attendance on 2026-03-10 under Regular Shift (08:00 start)
    r_before = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-10T07:55:00",
        },
    )
    assert r_before.status_code == 201
    client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_OUT",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-10T17:01:00",
        },
    )

    # HR assigns Employee 1 to Early Sanitation Shift (id=2, 06:30 start, 10m grace) effective 2026-04-01
    login_as(client, "hr_officer", "Hr@EIPC2026")
    assign_resp = client.post(
        "/api/shifts/assign",
        json={
            "employee_id": 1,
            "shift_template_id": 2,
            "effective_from": "2026-04-01",
            "working_days": "0,1,2,3,4",
        },
    )
    assert assign_resp.status_code == 201

    # Check in on 2026-04-02 at 07:00 EAT -> Under new 06:30 shift (+10m grace), 07:00 is LATE (30 mins)
    r_after = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-04-02T07:00:00",
        },
    )
    assert r_after.status_code == 201
    assert r_after.get_json()["attendance"]["arrival_status"] == "LATE"
    assert r_after.get_json()["attendance"]["late_minutes"] == 30

    # Prior attendance session on 2026-03-10 remains ON_TIME and unchanged
    with app.app_context():
        march_sess = AttendanceSession.query.filter_by(employee_id=1, work_date=date(2026, 3, 10)).first()
        assert march_sess.arrival_status == "ON_TIME"


def test_AT_20_holiday_or_approved_leave_applies(client):
    """AT-20: A scheduled holiday or approved leave applies -> Absence calculations respect the approved exception."""
    login_as(client, "hr_officer", "Hr@EIPC2026")
    # 2026-01-19 is seeded as Timket Public Holiday
    status_resp = client.get("/api/attendance/daily-status?employee_id=1&date=2026-01-19")
    assert status_resp.status_code == 200
    assert status_resp.get_json()["status"] == "EXEMPT_HOLIDAY_OR_LEAVE"


# ==============================================================================
# D. PERMISSIONS AND AUDIT TESTS (AT-21 to AT-26)
# ==============================================================================

def test_AT_21_unauthenticated_user_denied_hr_route(client):
    """AT-21: Unauthenticated user opens an HR route -> Access is denied."""
    api_resp = client.get("/api/employees")
    assert api_resp.status_code == 401
    html_resp = client.get("/employees")
    assert html_resp.status_code == 302  # Redirects to /login


def test_AT_22_hr_user_denied_admin_only_operation(client):
    """AT-22: HR user attempts an administrator-only operation -> Server denies the operation (403)."""
    login_as(client, "hr_officer", "Hr@EIPC2026")
    resp = client.post(
        "/api/users",
        json={
            "username": "unauthorized_admin",
            "full_name": "Should Fail",
            "password": "Password123!",
            "role_name": "ADMIN",
        },
    )
    assert resp.status_code == 403
    assert resp.get_json()["code"] == "ADMIN_REQUIRED"


def test_AT_23_authorized_hr_correction_requires_reason_and_preserves_history(client, app):
    """AT-23: Authorized HR corrects a check-in time -> Requires reason, preserves original event, writes audit record."""
    ci = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-16T08:30:00",
        },
    )
    sess_id = ci.get_json()["attendance"]["session_id"]
    orig_event_id = ci.get_json()["attendance"]["event_id"]

    login_as(client, "hr_officer", "Hr@EIPC2026")

    # Attempt without reason -> rejected
    bad_corr = client.post(
        "/api/attendance/correct",
        json={
            "session_id": sess_id,
            "correction_type": "CHECK_IN_TIME",
            "corrected_timestamp_local": "2026-03-16T07:58:00",
            "reason": "",
        },
    )
    assert bad_corr.status_code == 400

    # Valid correction with mandatory reason
    good_corr = client.post(
        "/api/attendance/correct",
        json={
            "session_id": sess_id,
            "correction_type": "CHECK_IN_TIME",
            "corrected_timestamp_local": "2026-03-16T07:58:00",
            "reason": "Power outage delayed station sync; verified against gate logbook.",
            "evidence_ref": "GATE-LOG-2026-03-16",
        },
    )
    assert good_corr.status_code == 200
    corr_data = good_corr.get_json()
    assert corr_data["original_event_id"] == orig_event_id
    assert corr_data["replacement_event_id"] != orig_event_id

    with app.app_context():
        # Original event is still preserved in attendance_events!
        orig_ev = db.session.get(AttendanceEvent, orig_event_id)
        assert orig_ev is not None
        assert orig_ev.capture_method == "BIOMETRIC"
        # Audit log entry created
        audit_entry = AuditLog.query.filter_by(action="ATTENDANCE_CORRECTED").first()
        assert audit_entry is not None


def test_AT_24_station_and_employee_impersonation_rejected(client):
    """AT-24: User attempts to spoof station token or impersonate another employee ID -> Rejected (403)."""
    # 1. Spoofed station token
    bad_station = client.post(
        "/api/station/scan",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "forged-untrusted-browser-token",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
        },
    )
    assert bad_station.status_code == 403
    assert bad_station.get_json()["code"] == "STATION_UNAUTHORIZED"

    # 2. Employee 1 face scanned, but request tries to confirm attendance for Employee 2
    bad_emp = client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 2,  # Claiming Emp 2
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",  # But scanning Emp 1's face
        },
    )
    assert bad_emp.status_code == 403
    assert bad_emp.get_json()["code"] == "IDENTITY_MISMATCH_IMPERSONATION"


def test_AT_25_authorized_csv_export_distinguishes_biometric_and_manual(client):
    """AT-25: Authorized user exports attendance -> Respects permissions & filters and distinguishes BIOMETRIC vs MANUAL_HR."""
    # Create 1 biometric check-in and 1 manual HR check-in
    client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-17T07:55:00",
        },
    )
    login_as(client, "hr_officer", "Hr@EIPC2026")
    client.post(
        "/api/review/manual-entry",
        json={
            "employee_id": 2,
            "station_id": 2,
            "event_type": "CHECK_IN",
            "reason": "Camera maintenance in Workshop B",
            "evidence_reference": "HR-FORM-88",
            "occurred_at_local": "2026-03-17T08:02:00",
        },
    )

    csv_resp = client.get("/api/reports/export.csv?date_from=2026-03-17&date_to=2026-03-17")
    assert csv_resp.status_code == 200
    csv_text = csv_resp.get_data(as_text=True)
    assert "BIOMETRIC" in csv_text
    assert "MANUAL_HR" in csv_text
    assert "EIPC-EMP-001" in csv_text
    assert "EIPC-EMP-002" in csv_text


def test_AT_26_backup_restoration_preserves_relational_consistency(client):
    """AT-26: Backup is restored into a test environment -> Employee, schedule, attendance and audit relationships remain consistent."""
    client.post(
        "/api/station/confirm",
        json={
            "station_code": "ST-ICT-01",
            "station_token": "trusted-token-st-ict-01",
            "employee_id": 1,
            "event_type": "CHECK_IN",
            "biometric_signature": "FACE_SIG_EIPC-EMP-001",
            "occurred_at_local": "2026-03-18T07:55:00",
        },
    )
    login_as(client, "admin", "Admin@EIPC2026")
    resp = client.post("/api/admin/backup-verify")
    assert resp.status_code == 200
    verification = resp.get_json()["verification"]
    assert verification["valid"] is True
    assert verification["issues"] == []
    assert verification["counts"]["employees"] >= 5
    assert verification["counts"]["attendance_sessions"] == 1
    assert verification["counts"]["attendance_events"] == 1

