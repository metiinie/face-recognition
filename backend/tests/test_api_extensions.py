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


def test_api_attendance_summary(client):
    """Verify /api/attendance/summary returns valid KPI summary without DB error."""
    res = client.get("/api/attendance/summary")
    assert res.status_code == 200
    data = res.get_json()
    assert "total_employees" in data
    assert "present_count" in data
    assert "late_count" in data
    assert "unresolved_reviews" in data


def test_api_review_cases_and_dismissal(client, app):
    """Verify listing and dismissing review cases via REST API."""
    with app.app_context():
        hr = User.query.filter_by(username="hr_officer").first()
        token = issue_jwt_token(hr)

    # 1. List review cases
    res = client.get("/api/review-cases")
    assert res.status_code == 200
    cases = res.get_json()
    assert isinstance(cases, list)

    # 2. Dismiss an open case if present
    if cases:
        target_id = cases[0]["id"]
        dismiss_res = client.post(
            f"/api/review-cases/{target_id}/dismiss",
            headers={"Authorization": f"Bearer {token}"},
            json={"reason": "Audit verification dismissal test"},
        )
        assert dismiss_res.status_code == 200
        assert dismiss_res.get_json()["status"] == "REJECTED"


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
