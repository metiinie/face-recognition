"""
Automated Acceptance & Integration Tests for Version 2 / Option B:
Continuous-Entrance Multi-Face Recognition Pipeline.
Tests:
  - Multi-face spatial cluster detection and 128-D embedding extraction
  - Simultaneous multi-person recognition matching
  - Automated hands-free attendance punch logging (CHECK_IN and CHECK_OUT)
  - Gate pass-through temporal cooldown prevention
  - Gate status telemetry, configuration, and multi-person crowd simulation
"""
from datetime import datetime, timedelta
import numpy as np
from PIL import Image
import pytest

from backend import create_app
from backend.config import TestConfig
from backend.database import db
from backend.database.models import (
    User,
    Employee,
    AttendanceStation,
    AttendanceSession,
    AttendanceEvent,
    FaceTemplate,
    utc_now,
)
from backend.database.seed import seed_initial_data
from backend.face_engine.recognizer import (
    extract_multiple_faces_from_image,
    recognize_multi_face_frame,
)
from backend.face_enrollment.service import decrypt_embedding
from backend.continuous_entrance.service import (
    ContinuousEntranceManager,
    process_continuous_entrance_frame,
)
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


def test_multi_face_image_extraction():
    """Verify that multi-face extraction identifies separate face bounding boxes."""
    img = Image.new("RGB", (640, 480), color=(240, 240, 240))
    arr = np.array(img, dtype=np.uint8)

    # Person 1 face patch on left (x=100..200, y=100..250)
    arr[100:250, 100:200] = [215, 160, 130]
    # Person 2 face patch on right (x=400..500, y=100..250)
    arr[100:250, 400:500] = [205, 150, 120]

    test_img = Image.fromarray(arr)
    faces = extract_multiple_faces_from_image(test_img)

    assert isinstance(faces, list)
    assert len(faces) >= 2
    box1, box2 = faces[0]["bounding_box"], faces[1]["bounding_box"]
    assert box1["x"] != box2["x"]
    assert "embedding" in faces[0]
    assert len(faces[0]["embedding"]) == 128


def test_v2_continuous_frame_recognition(app):
    """Verify simultaneous multi-person biometric matching against enrolled templates."""
    with app.app_context():
        payload = {
            "simulated_signatures": ["FACE_SIG_EIPC-EMP-001", "FACE_SIG_EIPC-EMP-002"],
        }
        res = recognize_multi_face_frame(payload, decrypt_fn=decrypt_embedding)
        assert res["faces_detected"] == 2
        faces = res["faces"]

        assert faces[0]["matched"] is True
        assert faces[0]["employee"]["employee_number"] == "EIPC-EMP-001"
        assert faces[1]["matched"] is True
        assert faces[1]["employee"]["employee_number"] == "EIPC-EMP-002"


def test_v2_continuous_gate_checkin_and_cooldown(app):
    """Verify automated hands-free check-in and pass-through cooldown."""
    with app.app_context():
        station = AttendanceStation.query.filter_by(station_code="ST-GATE-01").first()
        assert station is not None

        manager = ContinuousEntranceManager.get_instance()
        manager._cooldown_cache.clear()

        # 1. First passage through gate for EMP-003 (no prior open session)
        payload = {
            "simulated_staff": ["EIPC-EMP-003"],
            "gate_mode": "IN",
        }
        frame_res = manager.process_frame(station, payload, override_gate_mode="IN")
        assert frame_res["faces_detected"] == 1
        face1 = frame_res["faces"][0]
        assert face1["action_status"] == "CONFIRMED"
        assert face1["attendance_action"] == "CHECK_IN"

        # Verify event saved in database with CONTINUOUS_ENTRANCE capture_method
        emp = Employee.query.filter_by(employee_number="EIPC-EMP-003").first()
        event = AttendanceEvent.query.filter_by(
            employee_id=emp.id,
            capture_method="CONTINUOUS_ENTRANCE",
            event_type="CHECK_IN",
        ).first()
        assert event is not None
        assert event.station_id == station.id

        # 2. Immediate second frame (person still in camera view 1 second later)
        frame_res_immediate = manager.process_frame(station, payload, override_gate_mode="IN")
        face_immediate = frame_res_immediate["faces"][0]
        assert face_immediate["action_status"] == "COOLDOWN_ACTIVE"
        assert "Cooldown active" in face_immediate["message"]

        # 3. Simulate advance past cooldown (e.g. 25 seconds later)
        manager._cooldown_cache[(station.station_code, emp.id)] = utc_now() - timedelta(seconds=30)
        # Auto-detect should now recognize that employee has an OPEN session and perform CHECK_OUT
        frame_res_checkout = manager.process_frame(station, payload, override_gate_mode="AUTO_DETECT")
        face_checkout = frame_res_checkout["faces"][0]
        assert face_checkout["action_status"] == "CONFIRMED"
        assert face_checkout["attendance_action"] == "CHECK_OUT"


def test_v2_gate_api_endpoints(client, app):
    """Verify V2 REST endpoints: process-frame, status, config, and simulation."""
    with app.app_context():
        hr = User.query.filter_by(username="hr_officer").first()
        token = issue_jwt_token(hr)

    # 1. Process continuous frame via API for EMP-004 (no open session)
    proc_res = client.post(
        "/api/v2/entrance/process-frame",
        json={
            "station_code": "ST-GATE-01",
            "simulated_staff": ["EIPC-EMP-004"],
            "gate_mode": "IN",
        },
    )
    assert proc_res.status_code == 200
    data = proc_res.get_json()
    assert "faces_detected" in data
    assert data["station_code"] == "ST-GATE-01"

    # 2. Get Gate Stream Status
    status_res = client.get("/api/v2/entrance/status?station_code=ST-GATE-01")
    assert status_res.status_code == 200
    status_data = status_res.get_json()
    assert "station_code" in status_data
    assert "gate_mode" in status_data
    assert "today_total_passages" in status_data
    assert "recent_passages" in status_data

    # 3. Configure Gate Mode
    cfg_res = client.post(
        "/api/v2/entrance/gate-config",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "station_code": "ST-GATE-01",
            "gate_mode": "IN",
            "cooldown_sec": 15,
        },
    )
    assert cfg_res.status_code == 200
    assert cfg_res.get_json()["gate_config"]["gate_mode"] == "IN"

    # 4. Multi-person Crowd Simulation
    sim_res = client.post(
        "/api/v2/entrance/simulate",
        json={
            "station_code": "ST-GATE-01",
            "simulated_staff": ["EIPC-EMP-001", "EIPC-EMP-003"],
            "gate_mode": "AUTO_DETECT",
        },
    )
    assert sim_res.status_code == 200
    sim_data = sim_res.get_json()
    assert sim_data["faces_detected"] == 2
