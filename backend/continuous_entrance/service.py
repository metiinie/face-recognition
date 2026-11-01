"""
Continuous Entrance Recognition Pipeline (Option B / Version 2).
Ethio-Italy Polytechnic College (EIPC), Dire Dawa.

Reuses the exact same face_engine, attendance, and database layers
to provide high-throughput, multi-person continuous gate attendance.
"""
from datetime import datetime, timedelta, timezone, date
import threading
from flask import current_app
from backend.database import db, transactional_session
from backend.database.models import (
    Employee,
    AttendanceStation,
    AttendanceSession,
    AttendanceEvent,
    ReviewCase,
    utc_now,
    utc_to_local,
)
from backend.face_engine.recognizer import recognize_multi_face_frame
from backend.face_enrollment.service import decrypt_embedding
from backend.attendance.service import (
    confirm_attendance_action,
    get_open_session_for_employee,
)
from backend.stations.service import (
    verify_trusted_station,
    resolve_station_from_binding,
)
from backend.audit.service import record_audit_log
from backend.attendance_review.service import create_review_case


class ContinuousEntranceManager:
    """
    Thread-safe orchestrator for continuous entrance and exit gate processing.
    Handles temporal pass-through cooldown, automated check-in/out direction,
    unknown visitor alerts, and real-time gate telemetry.
    """
    _instance = None
    _lock = threading.Lock()

    def __init__(self):
        # Maps (station_code, employee_id) -> utc_timestamp of last passage
        self._cooldown_cache: dict[tuple[str, int], datetime] = {}
        # Gate configuration overrides: station_code -> {"gate_mode": str, "cooldown_sec": int}
        self._gate_configs: dict[str, dict] = {}
        # Recent passages memory buffer: station_code -> list[dict]
        self._recent_passages: dict[str, list[dict]] = {}
        # Unknown face throttle: station_code -> utc_timestamp of last review case
        self._unknown_review_throttle: dict[str, datetime] = {}

    @classmethod
    def get_instance(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def get_gate_config(self, station_code: str) -> dict:
        """Get or initialize gate configuration."""
        code = (station_code or "").upper().strip()
        if code not in self._gate_configs:
            self._gate_configs[code] = {
                "gate_mode": "AUTO_DETECT",  # "IN", "OUT", "AUTO_DETECT", "BIDIRECTIONAL"
                "cooldown_sec": 20,
            }
        return self._gate_configs[code]

    def configure_gate(self, station_code: str, gate_mode: str, cooldown_sec: int = 20) -> dict:
        """Update gate direction and cooldown settings."""
        code = (station_code or "").upper().strip()
        mode = gate_mode.upper().strip()
        if mode not in {"IN", "OUT", "AUTO_DETECT", "BIDIRECTIONAL"}:
            mode = "AUTO_DETECT"
        cfg = {
            "gate_mode": mode,
            "cooldown_sec": max(5, min(300, int(cooldown_sec))),
        }
        self._gate_configs[code] = cfg
        return cfg

    def process_frame(
        self,
        station: AttendanceStation,
        frame_payload: dict,
        override_gate_mode: str | None = None,
    ) -> dict:
        """
        Process a continuous video frame at an entrance station:
          1. Detects all faces present in the frame concurrently (multi-face).
          2. Compares against active enrolled biometric templates.
          3. Evaluates temporal cooldown for passing staff.
          4. Automatically confirms CHECK_IN or CHECK_OUT based on gate mode & session state.
          5. Logs unknown visitors to the HR exception queue (throttled).
        """
        now = utc_now()
        cfg = self.get_gate_config(station.station_code)
        gate_mode = (override_gate_mode or cfg.get("gate_mode", "AUTO_DETECT")).upper().strip()
        cooldown_sec = cfg.get("cooldown_sec", 20)

        # 1. Multi-face recognition engine
        multi_rec = recognize_multi_face_frame(frame_payload, decrypt_fn=decrypt_embedding)
        faces = multi_rec.get("faces", [])

        processed_faces = []
        action_summaries = []

        for face in faces:
            track_id = face.get("track_id", 1)
            bbox = face.get("bounding_box", {})
            status = face.get("status")
            is_matched = face.get("matched", False)
            emp_info = face.get("employee")
            score = face.get("recognition_score", 0.0)

            face_result = {
                "track_id": track_id,
                "bounding_box": bbox,
                "matched": is_matched,
                "status": status,
                "recognition_score": score,
                "quality_score": face.get("quality_score", 0.0),
                "liveness_passed": face.get("liveness_passed", True),
                "employee": emp_info,
                "action_status": "NONE",
                "attendance_action": None,
                "message": "",
            }

            if is_matched and emp_info and emp_info.get("id"):
                emp_id = int(emp_info["id"])
                cache_key = (station.station_code, emp_id)
                last_time = self._cooldown_cache.get(cache_key)

                # Check temporal cooldown (AT-11 / AT-12 for continuous stream)
                if last_time and (now - last_time).total_seconds() < cooldown_sec:
                    remaining = int(cooldown_sec - (now - last_time).total_seconds())
                    face_result["action_status"] = "COOLDOWN_ACTIVE"
                    face_result["message"] = f"Passage recorded. Cooldown active ({remaining}s remaining)."
                else:
                    # Determine directional action
                    if gate_mode == "IN":
                        action = "CHECK_IN"
                    elif gate_mode == "OUT":
                        action = "CHECK_OUT"
                    else:
                        # AUTO_DETECT: if employee has open session -> checkout, else checkin
                        open_sess = get_open_session_for_employee(emp_id)
                        action = "CHECK_OUT" if open_sess else "CHECK_IN"

                    # Execute atomic attendance event recording
                    result, err_code, err_msg = confirm_attendance_action(
                        employee_id=emp_id,
                        station=station,
                        event_type=action,
                        recognition_score=score,
                        occurred_at=now,
                        capture_method="CONTINUOUS_ENTRANCE",
                    )

                    if result:
                        self._cooldown_cache[cache_key] = now
                        face_result["action_status"] = "CONFIRMED"
                        face_result["attendance_action"] = action
                        face_result["session_id"] = result.get("session_id")
                        face_result["is_late"] = result.get("is_late", False)
                        face_result["minutes_late"] = result.get("minutes_late", 0)
                        face_result["message"] = f"Automated {action} recorded at gate {station.station_code}."

                        # Buffer recent passage
                        passage_entry = {
                            "id": result.get("event_id") or f"P-{int(now.timestamp()*1000)}",
                            "timestamp_eat": utc_to_local(now).strftime("%H:%M:%S"),
                            "employee_number": emp_info.get("employee_number"),
                            "employee_name": emp_info.get("full_name"),
                            "department": emp_info.get("department"),
                            "event_type": action,
                            "match_score": score,
                            "station_code": station.station_code,
                            "is_late": result.get("is_late", False),
                        }
                        self._record_passage(station.station_code, passage_entry)

                        record_audit_log(
                            action="GATE_PASSAGE_RECORDED",
                            target_type="EMPLOYEE",
                            target_id=emp_info.get("employee_number"),
                            reason=f"Continuous entrance auto {action} at {station.station_code}",
                            details={
                                "gate_mode": gate_mode,
                                "match_score": score,
                                "session_id": result.get("session_id"),
                                "capture_method": "CONTINUOUS_ENTRANCE",
                            },
                            station_id=station.id,
                            commit=True,
                        )

                        action_summaries.append(f"{emp_info.get('full_name')} ({action})")
                    else:
                        face_result["action_status"] = "REJECTED"
                        face_result["message"] = err_msg or "Attendance confirmation was rejected."

            elif status == "UNKNOWN_FACE":
                face_result["action_status"] = "UNKNOWN_VISITOR"
                face_result["message"] = "Unrecognized person detected at gate."

                # Throttle review cases for unknown faces (at most 1 per 15s per gate)
                last_unknown = self._unknown_review_throttle.get(station.station_code)
                if not last_unknown or (now - last_unknown).total_seconds() > 15:
                    self._unknown_review_throttle[station.station_code] = now
                    try:
                        rc = create_review_case(
                            station_id=station.id,
                            case_type="CONTINUOUS_ENTRANCE_UNKNOWN",
                            reason=f"Continuous gate detector captured unrecognized face passing through {station.station_code}",
                            claimed_employee_number=None,
                            candidate_employee_id=None,
                        )
                        face_result["review_case_id"] = rc.id
                    except Exception:
                        pass

            elif status == "UNCERTAIN_MATCH":
                face_result["action_status"] = "UNCERTAIN_CANDIDATE"
                face_result["message"] = "Confidence below threshold for autonomous gate passage."

            elif status == "EMPLOYEE_INACTIVE":
                face_result["action_status"] = "INACTIVE_BLOCKED"
                face_result["message"] = "Inactive employee blocked at gate."

            processed_faces.append(face_result)

        return {
            "station_code": station.station_code,
            "station_name": station.name,
            "gate_mode": gate_mode,
            "timestamp": now.isoformat(),
            "timestamp_eat": utc_to_local(now).strftime("%Y-%m-%d %H:%M:%S"),
            "faces_detected": len(processed_faces),
            "faces": processed_faces,
            "summary_actions": action_summaries,
        }

    def _record_passage(self, station_code: str, passage: dict):
        code = (station_code or "").upper().strip()
        if code not in self._recent_passages:
            self._recent_passages[code] = []
        self._recent_passages[code].insert(0, passage)
        if len(self._recent_passages[code]) > 40:
            self._recent_passages[code] = self._recent_passages[code][:40]

    def get_gate_status(self, station: AttendanceStation) -> dict:
        """Get live stream status, throughput metrics and recent gate passages."""
        code = station.station_code
        cfg = self.get_gate_config(code)
        recent = self._recent_passages.get(code, [])

        today_start = utc_now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_events = AttendanceEvent.query.filter(
            AttendanceEvent.station_id == station.id,
            AttendanceEvent.occurred_at >= today_start,
            AttendanceEvent.capture_method == "CONTINUOUS_ENTRANCE",
        ).all()

        check_ins = sum(1 for e in today_events if e.event_type == "CHECK_IN")
        check_outs = sum(1 for e in today_events if e.event_type == "CHECK_OUT")

        return {
            "station_code": station.station_code,
            "station_name": station.name,
            "department": station.department.name if station.department else "",
            "location": station.location,
            "camera_status": station.camera_status,
            "gate_mode": cfg.get("gate_mode", "AUTO_DETECT"),
            "cooldown_sec": cfg.get("cooldown_sec", 20),
            "today_total_passages": len(today_events),
            "today_checkins": check_ins,
            "today_checkouts": check_outs,
            "recent_passages": recent[:25],
        }


# Module level helper function
def process_continuous_entrance_frame(
    station: AttendanceStation,
    frame_payload: dict,
    override_gate_mode: str | None = None,
) -> dict:
    return ContinuousEntranceManager.get_instance().process_frame(
        station=station,
        frame_payload=frame_payload,
        override_gate_mode=override_gate_mode,
    )
