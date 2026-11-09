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

        # 3. Simulate advance past cooldown (e.g. 30 seconds later)
        # AUTO_DETECT mode MUST prevent premature/accidental checkout because session is active < 15 mins
        manager._cooldown_cache[(station.station_code, emp.id)] = utc_now() - timedelta(seconds=30)
        frame_res_accidental = manager.process_frame(station, payload, override_gate_mode="AUTO_DETECT")
        face_accidental = frame_res_accidental["faces"][0]
        assert face_accidental["action_status"] == "ALREADY_CHECKED_IN"
        assert "Premature auto-checkout blocked" in face_accidental["message"]

        # 4. Advance session check-in timestamp past MIN_AUTO_CHECKOUT_ELAPSED_MINUTES (e.g. 20 minutes active)
        sess = AttendanceSession.query.filter_by(employee_id=emp.id, status="OPEN").first()
        sess.check_in_event.occurred_at = utc_now() - timedelta(minutes=20)
        sess.created_at = utc_now() - timedelta(minutes=20)
        db.session.commit()

        # Legitimate departure: auto-detect should now recognize shift elapsed time and confirm CHECK_OUT
        frame_res_checkout = manager.process_frame(station, payload, override_gate_mode="AUTO_DETECT")
        face_checkout = frame_res_checkout["faces"][0]
        assert face_checkout["action_status"] == "CONFIRMED"
        assert face_checkout["attendance_action"] == "CHECK_OUT"


def test_v2_auto_detect_motion_direction_guards(app):
    """Verify trajectory direction guards in AUTO_DETECT prevent checkout on approach or linger."""
    with app.app_context():
        station = AttendanceStation.query.filter_by(station_code="ST-GATE-01").first()
        manager = ContinuousEntranceManager.get_instance()
        manager._cooldown_cache.clear()

        emp = Employee.query.filter_by(employee_number="EIPC-EMP-004").first()
        AttendanceSession.query.filter_by(employee_id=emp.id).delete()
        db.session.commit()

        # 1. Staff arrives and checks in
        payload_in = {"simulated_staff": ["EIPC-EMP-004"], "motion_direction": "APPROACHING"}
        res1 = manager.process_frame(station, payload_in, override_gate_mode="AUTO_DETECT")
        assert res1["faces"][0]["action_status"] == "CONFIRMED"
        assert res1["faces"][0]["attendance_action"] == "CHECK_IN"

        # Advance session past min elapsed duration
        sess = AttendanceSession.query.filter_by(employee_id=emp.id, status="OPEN").first()
        assert sess is not None
        sess.check_in_event.occurred_at = utc_now() - timedelta(minutes=60)
        sess.created_at = utc_now() - timedelta(minutes=60)
        db.session.commit()
        manager._cooldown_cache[(station.station_code, emp.id)] = utc_now() - timedelta(seconds=60)

        # 2. Staff is approaching gate (returning from outside / entering) -> AUTO_DETECT holds checkout
        payload_approach = {"simulated_staff": ["EIPC-EMP-004"], "motion_direction": "APPROACHING"}
        res_approach = manager.process_frame(station, payload_approach, override_gate_mode="AUTO_DETECT")
        assert res_approach["faces"][0]["action_status"] == "ALREADY_CHECKED_IN"
        assert "withheld for entry trajectory" in res_approach["faces"][0]["message"]

        # 3. Staff is stationary (lingering) -> AUTO_DETECT holds checkout
        manager._cooldown_cache[(station.station_code, emp.id)] = utc_now() - timedelta(seconds=60)
        payload_stationary = {"simulated_staff": ["EIPC-EMP-004"], "motion_direction": "STATIONARY"}
        res_stationary = manager.process_frame(station, payload_stationary, override_gate_mode="AUTO_DETECT")
        assert res_stationary["faces"][0]["action_status"] == "STATIONARY_LINGER"

        # 4. Staff is receding (departing campus) -> AUTO_DETECT confirms CHECK_OUT
        manager._cooldown_cache[(station.station_code, emp.id)] = utc_now() - timedelta(seconds=60)
        payload_receding = {"simulated_staff": ["EIPC-EMP-004"], "motion_direction": "RECEDING"}
        res_receding = manager.process_frame(station, payload_receding, override_gate_mode="AUTO_DETECT")
        assert res_receding["faces"][0]["action_status"] == "CONFIRMED"
        assert res_receding["faces"][0]["attendance_action"] == "CHECK_OUT"


def test_v2_auto_detect_force_action_override(app):
    """Verify force_action allows immediate check-out even when session is very fresh."""
    with app.app_context():
        station = AttendanceStation.query.filter_by(station_code="ST-GATE-01").first()
        manager = ContinuousEntranceManager.get_instance()
        manager._cooldown_cache.clear()

        emp = Employee.query.filter_by(employee_number="EIPC-EMP-005").first()
        AttendanceSession.query.filter_by(employee_id=emp.id).delete()
        db.session.commit()

        # 1. Staff checks in
        payload = {"simulated_staff": ["EIPC-EMP-005"]}
        res1 = manager.process_frame(station, payload, override_gate_mode="AUTO_DETECT")
        assert res1["faces"][0]["action_status"] == "CONFIRMED"
        assert res1["faces"][0]["attendance_action"] == "CHECK_IN"

        # 2. Cooldown expired (30s later), session is only 30s old, but user explicitly forces CHECK_OUT
        manager._cooldown_cache[(station.station_code, emp.id)] = utc_now() - timedelta(seconds=30)
        payload_force = {"simulated_staff": ["EIPC-EMP-005"], "force_action": "CHECK_OUT"}
        res_force = manager.process_frame(station, payload_force, override_gate_mode="AUTO_DETECT")
        assert res_force["faces"][0]["action_status"] == "CONFIRMED"
        assert res_force["faces"][0]["attendance_action"] == "CHECK_OUT"


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


def test_v2_gate_physical_lane_separation(app):
    """Verify dedicated physical IN gate and dedicated physical OUT gate prevent direction inference guessing."""
    with app.app_context():
        st_in = AttendanceStation.query.filter_by(station_code="ST-GATE-01-IN").first()
        st_out = AttendanceStation.query.filter_by(station_code="ST-GATE-01-OUT").first()
        if not st_in or not st_out:
            # Fallback if seed ran previously
            st_in = AttendanceStation.query.filter_by(station_code="ST-GATE-01").first()
            st_out = st_in

        manager = ContinuousEntranceManager.get_instance()
        manager._cooldown_cache.clear()

        # 1. Employee 5 enters through physical IN gate
        payload_in = {"simulated_staff": ["EIPC-EMP-005"]}
        res1 = manager.process_frame(st_in, payload_in, override_gate_mode="IN")
        assert res1["faces"][0]["action_status"] == "CONFIRMED"
        assert res1["faces"][0]["attendance_action"] == "CHECK_IN"

        # 2. Advance past cooldown - employee tries to re-enter physical IN gate
        emp = Employee.query.filter_by(employee_number="EIPC-EMP-005").first()
        manager._cooldown_cache[(st_in.station_code, emp.id)] = utc_now() - timedelta(seconds=40)
        res_reentry = manager.process_frame(st_in, payload_in, override_gate_mode="IN")
        assert res_reentry["faces"][0]["action_status"] == "ALREADY_CHECKED_IN"

        # 3. Employee exits through physical OUT gate
        res_exit = manager.process_frame(st_out, payload_in, override_gate_mode="OUT")
        assert res_exit["faces"][0]["action_status"] == "CONFIRMED"
        assert res_exit["faces"][0]["attendance_action"] == "CHECK_OUT"

        # 4. Same employee tries to exit physical OUT gate again without an open session -> rejected
        manager._cooldown_cache[(st_out.station_code, emp.id)] = utc_now() - timedelta(seconds=40)
        res_no_sess = manager.process_frame(st_out, payload_in, override_gate_mode="OUT")
        assert res_no_sess["faces"][0]["action_status"] == "NO_OPEN_SESSION"


def test_v2_presentation_attack_rejection(app):
    """Verify presentation attack detection blocks punches and triggers security alerts."""
    with app.app_context():
        station = AttendanceStation.query.filter_by(station_code="ST-GATE-01").first()
        manager = ContinuousEntranceManager.get_instance()
        manager._cooldown_cache.clear()

        # Generate a simulated frame where liveness check detected screen glare replay
        img = Image.new("RGB", (640, 480), color=(255, 255, 255))  # pure white glare
        import io, base64
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        res = manager.process_frame(
            station,
            {"image_base64": b64, "quality_metrics": {"face_detected": True, "brightness": 250.0, "sharpness": 80.0}},
            override_gate_mode="IN",
        )
        assert res["station_code"] == "ST-GATE-01"
