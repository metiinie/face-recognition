"""
Security tests for station trust and recognition proof (extends AT-24):
  - Kiosk pages never leak station secrets.
  - Only an administrator can bind a device to a station.
  - Confirmation requires proof the server just recognized that employee at that station.
  - Simulation inputs and client timestamps are ignored when disabled.
"""
import pytest
from backend import create_app
from backend.config import TestConfig
from backend.database import db
from backend.database.models import AttendanceEvent, AttendanceSession, AttendanceCorrection
from backend.database.seed import seed_initial_data

ICT = {"station_code": "ST-ICT-01", "station_token": "trusted-token-st-ict-01"}
SIM_GOOD = {"brightness": 135.0, "sharpness": 92.0, "face_detected": True}


@pytest.fixture()
def app():
    application = create_app(config_class=TestConfig, seed_db=False)
    with application.app_context():
        db.create_all()
        seed_initial_data()
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


def _scan(client, emp_num, station=ICT):
    return client.post(
        "/api/station/scan",
        json={**station, "biometric_signature": f"FACE_SIG_{emp_num}", "quality_metrics": SIM_GOOD},
    )


def test_kiosk_page_never_renders_station_secrets(client):
    client.post("/login", data={"username": "admin", "password": "Admin@EIPC2026"})
    client.post("/station/provision", data={"station_code": "ST-ICT-01"})
    page = client.get("/station").get_data(as_text=True)
    assert "ST-ICT-01" in page
    assert "trusted-token" not in page


def test_unprovisioned_device_cannot_scan(client):
    resp = client.post(
        "/api/station/scan",
        json={"station_code": "ST-ICT-01", "biometric_signature": "FACE_SIG_EIPC-EMP-001", "quality_metrics": SIM_GOOD},
    )
    assert resp.status_code == 403


def test_provisioning_requires_admin(client):
    client.post("/login", data={"username": "hr_officer", "password": "Hr@EIPC2026"})
    assert client.post("/station/provision", data={"station_code": "ST-ICT-01"}).status_code == 403


def test_provisioned_kiosk_full_flow_and_admin_signed_out(client):
    client.post("/login", data={"username": "admin", "password": "Admin@EIPC2026"})
    client.post("/station/provision", data={"station_code": "ST-ICT-01"})

    # Admin session was cleared, so the kiosk is not left logged in.
    assert client.get("/api/employees").status_code == 401

    scan = client.post(
        "/api/station/scan",
        json={"biometric_signature": "FACE_SIG_EIPC-EMP-001", "quality_metrics": SIM_GOOD},
    ).get_json()
    assert scan["matched"] is True
    assert scan["station"]["station_code"] == "ST-ICT-01"

    confirm = client.post(
        "/api/station/confirm",
        json={"employee_id": scan["employee"]["id"], "event_type": "CHECK_IN",
              "recognition_token": scan["recognition_token"]},
    )
    assert confirm.status_code == 201
    assert confirm.get_json()["attendance"]["station_code"] == "ST-ICT-01"


def test_confirm_without_recognition_proof_is_rejected(client, app):
    resp = client.post("/api/station/confirm", json={**ICT, "employee_id": 1, "event_type": "CHECK_IN"})
    assert resp.status_code == 401
    assert resp.get_json()["error_code"] == "RECOGNITION_PROOF_REQUIRED"
    with app.app_context():
        assert AttendanceEvent.query.count() == 0


def test_recognition_token_cannot_be_reused_for_another_employee(client):
    token = _scan(client, "EIPC-EMP-001").get_json()["recognition_token"]
    resp = client.post(
        "/api/station/confirm",
        json={**ICT, "employee_id": 2, "event_type": "CHECK_IN", "recognition_token": token},
    )
    assert resp.status_code == 403
    assert resp.get_json()["code"] == "IDENTITY_MISMATCH_IMPERSONATION"


def test_recognition_token_cannot_be_used_at_another_station(client):
    token = _scan(client, "EIPC-EMP-001").get_json()["recognition_token"]
    resp = client.post(
        "/api/station/confirm",
        json={"station_code": "ST-AUTO-01", "station_token": "trusted-token-st-auto-01",
              "employee_id": 1, "event_type": "CHECK_IN", "recognition_token": token},
    )
    assert resp.status_code == 403


def test_tampered_recognition_token_rejected(client):
    token = _scan(client, "EIPC-EMP-001").get_json()["recognition_token"]
    resp = client.post(
        "/api/station/confirm",
        json={**ICT, "employee_id": 1, "event_type": "CHECK_IN", "recognition_token": token[:-4] + "AAAA"},
    )
    assert resp.status_code == 403
    assert resp.get_json()["error_code"] == "RECOGNITION_TOKEN_INVALID"


def test_simulated_signatures_ignored_when_simulation_disabled(client, app):
    app.config["ALLOW_SIMULATED_BIOMETRICS"] = False
    resp = _scan(client, "EIPC-EMP-001")
    assert resp.get_json()["matched"] is False


def test_client_timestamps_ignored_when_disabled(client, app):
    app.config["ALLOW_CLIENT_EVENT_TIMESTAMPS"] = False
    token = _scan(client, "EIPC-EMP-001").get_json()["recognition_token"]
    resp = client.post(
        "/api/station/confirm",
        json={**ICT, "employee_id": 1, "event_type": "CHECK_IN",
              "recognition_token": token, "occurred_at_local": "2020-01-01T08:00:00"},
    )
    assert resp.status_code == 201
    assert not resp.get_json()["attendance"]["occurred_at_local"].startswith("2020-01-01")

