import pytest
from backend import create_app
from backend.config import TestConfig
from backend.database import db
from backend.database.models import User, ReviewCase, Employee
from backend.database.seed import seed_initial_data
from backend.security.tokens import issue_jwt_token


@pytest.fixture()
def app():
    application = create_app(config_class=TestConfig, seed_db=False)
    with application.app_context():
        db.create_all()
        seed_initial_data()
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def test_api_attendance_summary(client, app):
    """Verify /api/attendance/summary enforces authentication and returns KPI summary."""
    # 1. Unauthenticated request is rejected
    unauth = client.get("/api/attendance/summary")
    assert unauth.status_code == 401

    # 2. Authenticated request succeeds
    with app.app_context():
        hr = User.query.filter_by(username="hr_officer").first()
        token = issue_jwt_token(hr)

    res = client.get("/api/attendance/summary", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.get_json()
    assert "total_employees" in data
    assert "present_count" in data
    assert "late_count" in data
    assert "unresolved_reviews" in data


def test_api_review_cases_and_dismissal(client, app):
    """Verify listing and dismissing review cases via REST API enforces auth."""
    # 1. Unauthenticated request rejected
    unauth = client.get("/api/review-cases")
    assert unauth.status_code == 401

    with app.app_context():
        hr = User.query.filter_by(username="hr_officer").first()
        token = issue_jwt_token(hr)

    # 2. List review cases with auth
    res = client.get("/api/review-cases", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    cases = res.get_json()
    assert isinstance(cases, list)

    # 3. Dismiss an open case if present
    if cases:
        target_id = cases[0]["id"]
        dismiss_res = client.post(
            f"/api/review-cases/{target_id}/dismiss",
            headers={"Authorization": f"Bearer {token}"},
            json={"reason": "Audit verification dismissal test"},
        )
        assert dismiss_res.status_code == 200
        assert dismiss_res.get_json()["status"] == "REJECTED"


def test_api_security_enforcement_and_station_provisioning(client, app):
    """Verify security controls: audit logs, face enroll/purge, and station provisioning API."""
    # 1. Audit logs rejected without authentication
    assert client.get("/api/audit-logs").status_code == 401

    # 2. Face enroll and purge rejected without authentication
    assert client.post("/api/face/enroll", json={"employee_id": 1}).status_code == 401
    assert client.post("/api/face/purge", json={"employee_id": 1}).status_code == 401

    with app.app_context():
        hr = User.query.filter_by(username="hr_officer").first()
        hr_token = issue_jwt_token(hr)
        admin = User.query.filter_by(username="admin").first()
        admin_token = issue_jwt_token(admin)

    # 3. Authenticated HR can read audit logs
    audit_res = client.get("/api/audit-logs", headers={"Authorization": f"Bearer {hr_token}"})
    assert audit_res.status_code == 200

    # 4. Station provisioning requires admin
    non_admin = client.post(
        "/api/station/provision",
        headers={"Authorization": f"Bearer {hr_token}"},
        json={"station_code": "ST-ICT-01"},
    )
    assert non_admin.status_code == 403

    # 5. Admin can provision station via API
    prov_res = client.post(
        "/api/station/provision",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"station_code": "ST-ICT-01"},
    )
    assert prov_res.status_code == 200
    assert prov_res.get_json()["status"] == "PROVISIONED"
    assert "eipc_station=" in prov_res.headers.get("Set-Cookie", "")

    # 6. Current station endpoint reports active binding
    curr_res = client.get("/api/station/current")
    assert curr_res.status_code == 200
    assert curr_res.get_json()["provisioned"] is True
    assert curr_res.get_json()["station"]["station_code"] == "ST-ICT-01"


def test_api_reports_sessions_endpoint(client, app):
    """Verify /api/reports/sessions returns structured session details."""
    with app.app_context():
        hr = User.query.filter_by(username="hr_officer").first()
        token = issue_jwt_token(hr)

    res = client.get(
        "/api/reports/sessions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    data = res.get_json()
    assert "sessions" in data
    assert "total" in data
    assert isinstance(data["sessions"], list)


def test_api_employees_search_filter(client, app):
    """Verify /api/employees supports query search and department filters."""
    with app.app_context():
        hr = User.query.filter_by(username="hr_officer").first()
        token = issue_jwt_token(hr)

    # Search by employee name
    res = client.get(
        "/api/employees?q=Abebe",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    data = res.get_json()
    assert "employees" in data
    assert any("Abebe" in e["full_name"] for e in data["employees"])


def test_api_shifts_templates_and_stations(client, app):
    """Verify listing shift templates, assignments, exceptions, and stations."""
    with app.app_context():
        hr = User.query.filter_by(username="hr_officer").first()
        token = issue_jwt_token(hr)

    # Shift templates
    res = client.get("/api/shifts/templates", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    templates = res.get_json()
    assert isinstance(templates, list)
    assert len(templates) > 0
    assert "ethiopian_display" in templates[0]

    # Shift assignments
    res_assign = client.get("/api/shifts/assignments", headers={"Authorization": f"Bearer {token}"})
    assert res_assign.status_code == 200
    assignments = res_assign.get_json()
    assert isinstance(assignments, list)

    # Exceptions
    res_exc = client.get("/api/shifts/exceptions", headers={"Authorization": f"Bearer {token}"})
    assert res_exc.status_code == 200
    exceptions = res_exc.get_json()
    assert isinstance(exceptions, list)

    # Stations
    res_stations = client.get("/api/stations", headers={"Authorization": f"Bearer {token}"})
    assert res_stations.status_code == 200
    stations = res_stations.get_json()
    assert isinstance(stations, list)
    assert len(stations) > 0
    assert any(s["station_code"] == "ST-ICT-01" for s in stations)


def test_api_policies_and_update(client, app):
    """Verify Section 8 operational policy retrieval and admin status updates."""
    with app.app_context():
        admin = User.query.filter_by(username="admin").first()
        token = issue_jwt_token(admin)

    # Get policies
    res = client.get("/api/policies", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    policies = res.get_json()
    assert isinstance(policies, list)
    assert len(policies) >= 5

    # Update policy
    target_id = policies[0]["id"]
    update_res = client.post(
        f"/api/policies/{target_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"status": "CONFIRMED", "decision_notes": "Tested in API test suite"},
    )
    assert update_res.status_code == 200
    assert update_res.get_json()["status"] == "CONFIRMED"


def test_api_update_employee_and_dynamic_summary(client, app):
    """Verify updating employee profile details and dynamic summary fields."""
    with app.app_context():
        hr = User.query.filter_by(username="hr_officer").first()
        token = issue_jwt_token(hr)
        emp = Employee.query.first()
        emp_id = emp.id

    # Update employee
    update_res = client.put(
        f"/api/employees/{emp_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"phone": "+251911999999", "job_category": "REGULAR_STAFF"},
    )
    assert update_res.status_code == 200
    data = update_res.get_json()
    assert data["status"] == "UPDATED"
    assert data["employee"]["phone"] == "+251911999999"

    # Verify summary has dynamic fields
    sum_res = client.get(
        "/api/attendance/summary",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert sum_res.status_code == 200
    sum_data = sum_res.get_json()
    assert "hourly_breakdown" in sum_data
    assert "department_breakdown" in sum_data
    assert isinstance(sum_data["hourly_breakdown"], list)
    assert isinstance(sum_data["department_breakdown"], list)


def test_websocket_entrance_streaming_and_broadcast(app):
    """Verify WebSocket connectivity, station room joining, frame processing, and attendance broadcast."""
    from backend.socketio_service import socketio, broadcast_attendance_event

    test_client = socketio.test_client(app)
    assert test_client.is_connected()

    # Verify connection acknowledgment event
    received = test_client.get_received()
    assert any(msg["name"] == "connection_ack" for msg in received)

    # Test joining station room
    test_client.emit("join_station", {"station_code": "ST-GATE-01"})
    received = test_client.get_received()
    assert any(
        msg["name"] == "joined_station" and msg["args"][0]["station_code"] == "ST-GATE-01"
        for msg in received
    )

    # Test process_frame event handler
    test_client.emit("process_frame", {
        "station_code": "ST-GATE-01",
        "frame_base64": "",
        "gate_mode": "AUTO_DETECT",
        "cooldown_sec": 20,
    })
    # Client should remain connected and process gracefully without exception
    assert test_client.is_connected()

    # Test broadcast_attendance_event
    broadcast_attendance_event("TEST_EVENT", {"detail": "verification"})
    received = test_client.get_received()
    assert any(
        msg["name"] == "attendance_live_event" and msg["args"][0]["type"] == "TEST_EVENT"
        for msg in received
    )

    # Disconnect
    test_client.disconnect()
    assert not test_client.is_connected()


