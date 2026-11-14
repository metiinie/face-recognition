"""
Regression tests verifying backend contracts relied upon by the active frontend UI:
  - /api/auth/login & /api/auth/me payload parity (fullName + ADMIN role)
  - /api/attendance/summary EAT (UTC+3) target_date resolution
  - ContinuousEntranceManager restart hydration of recent_passages from DB
  - Socket.IO live broadcasts from HTTP confirm / entrance endpoints
"""
from datetime import datetime, date
import pytest
from backend import create_app
from backend.config import TestConfig
from backend.continuous_entrance.service import ContinuousEntranceManager
from backend.database import db
from backend.database.models import User, Employee
from backend.security.tokens import issue_jwt_token


@pytest.fixture()
def app():
    ContinuousEntranceManager._instance = None
    application = create_app(config_class=TestConfig, seed_db=False)
    with application.app_context():
        db.create_all()
        from backend.database.seed import seed_initial_data
        seed_initial_data()
        yield application
        db.session.remove()
        db.drop_all()
    ContinuousEntranceManager._instance = None


@pytest.fixture()
def client(app):
    return app.test_client()


def test_login_and_me_profile_parity(client):
    """Login returns both fullName and full_name matching /api/auth/me and seeded ADMIN role."""
    login_res = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "Admin@EIPC2026"},
    )
    assert login_res.status_code == 200
    body = login_res.get_json()
    assert body["user"]["role"] == "ADMIN"
    assert body["user"]["full_name"] == "Ato Dawit Tadesse (System Admin)"
    assert body["user"]["fullName"] == body["user"]["full_name"]

    me_res = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert me_res.status_code == 200
    me = me_res.get_json()
    assert me["role"] == "ADMIN"
    assert me["fullName"] == body["user"]["fullName"]


def test_attendance_summary_uses_eat_date(client, app, monkeypatch):
    """Summary endpoint resolves target_date in EAT (UTC+3) even past 21:00 UTC."""
    from backend.reports.service import get_hr_dashboard_summary as real_summary

    captured = {}

    def spy_summary(target_date):
        captured["target_date"] = target_date
        return real_summary(target_date=target_date)

    # 22:30 UTC on Nov 14 is 01:30 EAT on Nov 15
    monkeypatch.setattr("backend.web_ui.api_routes.utc_now", lambda: datetime(2026, 11, 14, 22, 30, 0))
    monkeypatch.setattr("backend.web_ui.api_routes.get_hr_dashboard_summary", spy_summary)

    with app.app_context():
        admin = User.query.filter_by(username="admin").first()
        token = issue_jwt_token(admin)

    res = client.get("/api/attendance/summary", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert captured["target_date"] == date(2026, 11, 15)


def test_http_entrance_and_kiosk_broadcast_and_restart_hydration(client, app, monkeypatch):
    """HTTP entrance simulation and kiosk confirm emit Socket.IO events and hydrate after restart."""
    emitted = []

    monkeypatch.setattr(
        "backend.socketio_service.socketio.emit",
        lambda event, payload, **kwargs: emitted.append((event, payload, kwargs)),
    )

    with app.app_context():
        emp = Employee.query.filter_by(employee_number="EIPC-EMP-001").first()
        assert emp is not None

    # 1. Simulate multi-person gate passage over HTTP (2 employees)
    sim_res = client.post(
        "/api/v2/entrance/simulate",
        json={"station_code": "ST-GATE-01", "simulated_staff": ["EIPC-EMP-001", "EIPC-EMP-002"]},
    )
    assert sim_res.status_code == 200
    sim_data = sim_res.get_json()
    assert len(sim_data.get("summary_actions", [])) >= 1
    assert any(ev == "passage_event" for ev, _, _ in emitted)
    assert any(ev == "attendance_live_event" for ev, _, _ in emitted)

    # 2. Clear in-memory passage buffer to simulate Flask process restart and verify DB hydration
    ContinuousEntranceManager.get_instance()._recent_passages.clear()
    status_res = client.get("/api/v2/entrance/status?station_code=ST-GATE-01")
    assert status_res.status_code == 200
    status_data = status_res.get_json()
    assert status_data["today_total_passages"] >= 1
    assert len(status_data["recent_passages"]) >= 1
    assert "employee_name" in status_data["recent_passages"][0]
    assert "timestamp_eat" in status_data["recent_passages"][0]

    # 3. Kiosk recognize + confirm over HTTP also broadcasts attendance_live_event
    emitted.clear()
    rec_res = client.post(
        "/api/face/recognize",
        json={"station_code": "ST-ICT-01", "biometric_signature": "FACE_SIG_EIPC-EMP-003"},
    )
    assert rec_res.status_code == 200
    rec_data = rec_res.get_json()
    assert rec_data["matched"] is True

    confirm_res = client.post(
        "/api/attendance/confirm",
        json={"recognition_token": rec_data["recognition_token"], "station_code": "ST-ICT-01"},
    )
    assert confirm_res.status_code == 200
    assert any(
        ev == "attendance_live_event" and payload.get("type") == "KIOSK_CONFIRM"
        for ev, payload, _ in emitted
    )
