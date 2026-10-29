"""
Smoke tests that render every HTML screen (Screens 1-6) for each role,
so template errors are caught before HR staff hit them in a browser.
"""
import pytest
from backend import create_app
from backend.config import TestConfig
from backend.database import db
from backend.database.seed import seed_initial_data


@pytest.fixture()
def client():
    application = create_app(config_class=TestConfig, seed_db=False)
    with application.app_context():
        db.create_all()
        seed_initial_data()
        yield application.test_client()
        db.session.remove()
        db.drop_all()


def _login(client, username, password):
    return client.post("/login", data={"username": username, "password": password})


ALL_SCREENS = [
    "/station",
    "/employees",
    "/dashboard",
    "/reports",
    "/schedules-stations",
    "/users-review-audit",
]


def test_station_kiosk_renders_without_login(client):
    resp = client.get("/station")
    assert resp.status_code == 200
    assert b"Attendance Station" in resp.data


@pytest.mark.parametrize("path", ALL_SCREENS)
def test_admin_can_render_every_screen(client, path):
    _login(client, "admin", "Admin@EIPC2026")
    resp = client.get(path)
    assert resp.status_code == 200, f"{path} returned {resp.status_code}"


@pytest.mark.parametrize("path", ALL_SCREENS)
def test_hr_officer_can_render_every_screen(client, path):
    _login(client, "hr_officer", "Hr@EIPC2026")
    resp = client.get(path)
    assert resp.status_code == 200, f"{path} returned {resp.status_code}"


def test_auditor_is_read_only(client):
    _login(client, "auditor", "Audit@EIPC2026")
    assert client.get("/dashboard").status_code == 200
    assert client.get("/reports").status_code == 200
    assert client.get("/employees").status_code == 403
    assert client.get("/schedules-stations").status_code == 403


def test_dashboard_and_reports_with_filters(client):
    _login(client, "hr_officer", "Hr@EIPC2026")
    assert client.get("/dashboard?date=2026-03-01&department_id=1").status_code == 200
    assert client.get(
        "/reports?date_from=2026-01-01&date_to=2026-12-31&status=OPEN&capture_method=BIOMETRIC"
    ).status_code == 200


def test_bad_login_rejected(client):
    resp = _login(client, "admin", "wrong-password")
    assert resp.status_code == 401

