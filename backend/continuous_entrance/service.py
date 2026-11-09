"""
Continuous Entrance Recognition Pipeline (Option B / Version 2).
Ethio-Italy Polytechnic College (EIPC), Dire Dawa.

Features:
  - Deep neural face embeddings (SFace 128-D) + UltraFace ONNX detection.
  - Multi-face centroid and IoU tracking across video frames (MOT).
  - Multi-frame persistence requirement (prevents false single-frame automatic attendance).
  - Database-level duplicate and anti-replay protection.
  - Real presentation-attack detection (PAD) rejection and security alerts.
  - Physical lane gating (dedicated IN / OUT) and trajectory-based bidirectional gating.
  - Operational health monitoring, camera heartbeat, and real-time telemetry.
"""
from datetime import datetime, timedelta, timezone, date
import threading
import time
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
from backend.continuous_entrance.tracker import ContinuousMultiFaceTracker


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
        # Spoof alert throttle: station_code -> utc_timestamp of last alert
        self._spoof_review_throttle: dict[str, datetime] = {}
        # Multi-face persistent trackers: station_code -> ContinuousMultiFaceTracker
        self._trackers: dict[str, ContinuousMultiFaceTracker] = {}
        # Telemetry counters: station_code -> dict
        self._telemetry: dict[str, dict] = {}

    @classmethod
    def get_instance(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def get_tracker(self, station_code: str) -> ContinuousMultiFaceTracker:
        """Get or initialize persistent multi-face MOT tracker for a station."""
        code = (station_code or "").upper().strip()
        if code not in self._trackers:
            self._trackers[code] = ContinuousMultiFaceTracker(code)
        return self._trackers[code]

    def get_gate_config(self, station_code: str) -> dict:
        """Get or initialize gate configuration."""
        code = (station_code or "").upper().strip()
        if code not in self._gate_configs:
            # Default dedicated lane if code ends with -IN or -OUT
            default_mode = "IN" if code.endswith("-IN") else ("OUT" if code.endswith("-OUT") else "AUTO_DETECT")
            try:
                min_mins = current_app.config.get("MIN_AUTO_CHECKOUT_ELAPSED_MINUTES", 15)
                min_pers = current_app.config.get("TRACK_MIN_PERSISTENCE_FRAMES", 3)
            except Exception:
                min_mins = 15
                min_pers = 3
            self._gate_configs[code] = {
                "gate_mode": default_mode,  # "IN", "OUT", "AUTO_DETECT", "BIDIRECTIONAL"
                "cooldown_sec": 20,
                "min_checkout_elapsed_mins": min_mins,
                "min_persistence_frames": min_pers,
            }
        return self._gate_configs[code]

    def configure_gate(
        self,
        station_code: str,
        gate_mode: str,
        cooldown_sec: int = 20,
        min_checkout_elapsed_mins: int = 15,
        min_persistence_frames: int = 3,
    ) -> dict:
        """Update gate direction, cooldown settings, and tracking persistence frames."""
        code = (station_code or "").upper().strip()
        mode = gate_mode.upper().strip()
        if mode not in {"IN", "OUT", "AUTO_DETECT", "BIDIRECTIONAL"}:
            mode = "AUTO_DETECT"
        cfg = {
            "gate_mode": mode,
            "cooldown_sec": max(5, min(300, int(cooldown_sec))),
            "min_checkout_elapsed_mins": max(1, min(180, int(min_checkout_elapsed_mins))),
            "min_persistence_frames": max(1, min(10, int(min_persistence_frames))),
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
          1. Detects all faces concurrently with UltraFace ONNX + SFace 128-D neural embeddings.
          2. Associates detections with persistent multi-object tracking (MOT) across frames.
          3. Evaluates multi-frame track persistence (prevents single-frame false triggers).
          4. Rejects presentation attacks (PAD / anti-spoofing).
          5. Enforces database-level cooldown and anti-replay protection.
          6. Validates passage direction (physical IN/OUT gates or trajectory vector).
          7. Commits authorized attendance punches transactionally.
          8. Updates camera health heartbeat and real-time operational telemetry.
        """
        start_time = time.perf_counter()
        now = utc_now()
        cfg = self.get_gate_config(station.station_code)
        gate_mode = (override_gate_mode or cfg.get("gate_mode", "AUTO_DETECT")).upper().strip()
        cooldown_sec = cfg.get("cooldown_sec", 20)

        # Operational recovery: update station camera heartbeat
        try:
            station.last_heartbeat = now
            station.camera_status = "ONLINE"
            db.session.commit()
        except Exception:
            db.session.rollback()

        # 1. Multi-face recognition engine (UltraFace ONNX + SFace neural embedding)
        multi_rec = recognize_multi_face_frame(frame_payload, decrypt_fn=decrypt_embedding)
        raw_faces = multi_rec.get("faces", [])

        # Propagate motion_direction if specified in frame_payload (e.g. simulation or test override)
        motion_override = frame_payload.get("motion_direction")
        if motion_override:
            for rf in raw_faces:
                rf["motion_direction"] = motion_override

        # 2. Multi-face persistent tracking (Centroid + IoU MOT)
        tracker = self.get_tracker(station.station_code)
        is_simulation = bool(frame_payload.get("simulated_staff") or frame_payload.get("simulated_signatures"))
        faces = tracker.process_frame_detections(raw_faces, now)

        processed_faces = []
        action_summaries = []

        for face in faces:
            track_id = face.get("track_id", 1)
            bbox = face.get("bounding_box", {})
            status = face.get("status")
            is_matched = face.get("matched", False)
            emp_info = face.get("employee")
            score = face.get("recognition_score", 0.0)
            liveness_passed = face.get("liveness_passed", True)
            spoof_detected = face.get("spoof_detected", False)
            spoof_type = face.get("spoof_type")
            frames_seen = face.get("frames_seen", 1)
            motion_dir = face.get("motion_direction", "APPROACHING")
            is_punch_committed = face.get("is_punch_committed", False)

            face_result = {
                "track_id": track_id,
                "bounding_box": bbox,
                "matched": is_matched,
                "status": status,
                "recognition_score": score,
                "average_match_score": face.get("average_match_score", score),
                "matched_frames_count": face.get("matched_frames_count", 1),
                "identity_consensus_ratio": face.get("identity_consensus_ratio", 1.0),
                "quality_score": face.get("quality_score", 0.0),
                "liveness_passed": liveness_passed,
                "is_confirmed_live": face.get("is_confirmed_live", liveness_passed),
                "spoof_detected": spoof_detected,
                "spoof_type": spoof_type,
                "frames_seen": frames_seen,
                "motion_direction": motion_dir,
                "is_punch_committed": is_punch_committed,
                "employee": emp_info,
                "action_status": "NONE",
                "attendance_action": None,
                "message": "",
            }

            # 3. Presentation-Attack Detection (PAD) Enforcement
            if spoof_detected or not liveness_passed:
                face_result["action_status"] = "SPOOF_BLOCKED"
                face_result["message"] = f"Presentation attack rejected: {spoof_type or 'LIVENESS_FAILED'}"

                last_spoof = self._spoof_review_throttle.get(station.station_code)
                if not last_spoof or (now - last_spoof).total_seconds() > 10:
                    self._spoof_review_throttle[station.station_code] = now
                    record_audit_log(
                        action="GATE_PRESENTATION_ATTACK_ALERT",
                        target_type="EMPLOYEE",
                        target_id=emp_info.get("employee_number", "UNKNOWN") if emp_info else "UNKNOWN",
                        reason=f"Presentation attack rejected at {station.station_code}: {spoof_type or 'LIVENESS_FAILED'}",
                        details={
                            "liveness_score": face.get("liveness_score"),
                            "spoof_type": spoof_type,
                            "track_id": track_id,
                            "station_code": station.station_code,
                        },
                        station_id=station.id,
                        commit=True,
                    )
                    try:
                        create_review_case(
                            station_id=station.id,
                            case_type="PRESENTATION_ATTACK_DETECTED",
                            reason=f"Spoof detected at continuous gate {station.station_code}: {spoof_type or 'LIVENESS_FAILED'}",
                            claimed_employee_number=emp_info.get("employee_number") if emp_info else None,
                            candidate_employee_id=int(emp_info["id"]) if emp_info and emp_info.get("id") else None,
                        )
                    except Exception:
                        pass
                processed_faces.append(face_result)
                continue

            if is_matched and emp_info and emp_info.get("id"):
                emp_id = int(emp_info["id"])
                cache_key = (station.station_code, emp_id)
                last_time = self._cooldown_cache.get(cache_key)

                # 4. Temporal Cooldown & Database-Level Anti-Replay Protection
                in_cooldown = False
                remaining_sec = 0
                if last_time and (now - last_time).total_seconds() < cooldown_sec:
                    in_cooldown = True
                    remaining_sec = int(cooldown_sec - (now - last_time).total_seconds())

                if not in_cooldown and not is_simulation:
                    # Database-level verification across workers / restarts in real continuous operation
                    cooldown_cutoff = now - timedelta(seconds=cooldown_sec)
                    recent_db_event = AttendanceEvent.query.filter(
                        AttendanceEvent.employee_id == emp_id,
                        AttendanceEvent.occurred_at >= cooldown_cutoff,
                    ).order_by(AttendanceEvent.occurred_at.desc()).first()

                    if recent_db_event:
                        in_cooldown = True
                        evt_time = recent_db_event.occurred_at
                        if evt_time.tzinfo is None:
                            evt_time = evt_time.replace(tzinfo=timezone.utc)
                        remaining_sec = max(1, int(cooldown_sec - (now - evt_time).total_seconds()))

                if in_cooldown:
                    face_result["action_status"] = "COOLDOWN_ACTIVE"
                    face_result["message"] = f"Passage recorded. Cooldown active ({max(1, remaining_sec)}s remaining)."
                    processed_faces.append(face_result)
                    continue

                # 5. Multi-Frame Tracking Persistence & Identity Consensus (Prevents False Automatic Attendance)
                enforce_persistence = (not is_simulation) or bool(frame_payload.get("enforce_persistence"))

                if enforce_persistence and not is_punch_committed:
                    min_persistence_frames = cfg.get(
                        "min_persistence_frames",
                        current_app.config.get("TRACK_MIN_PERSISTENCE_FRAMES", 3) if current_app else 3,
                    )
                    min_matched_frames = current_app.config.get("TRACK_MIN_MATCHED_FRAMES", 2) if current_app else 2
                    min_duration_sec = current_app.config.get("TRACK_MIN_DURATION_SECONDS", 0.25) if current_app else 0.25
                    match_thresh = current_app.config.get("RECOGNITION_MATCH_THRESHOLD", 0.35) if current_app else 0.35

                    # Rule 5A: Target frame count persistence across the track
                    if frames_seen < min_persistence_frames:
                        face_result["action_status"] = "ACQUIRING_TRACK"
                        face_result["message"] = (
                            f"Tracking {emp_info.get('full_name')} "
                            f"(Acquiring persistence {frames_seen}/{min_persistence_frames} frames)..."
                        )
                        processed_faces.append(face_result)
                        continue

                    # Rule 5B: Biometric match consistency across track (at least min_matched_frames)
                    matched_count = face.get("matched_frames_count", 1)
                    if matched_count < min_matched_frames:
                        face_result["action_status"] = "ACQUIRING_TRACK"
                        face_result["message"] = (
                            f"Verifying biometric match for {emp_info.get('full_name')} "
                            f"(Confirmed {matched_count}/{min_matched_frames} frames)..."
                        )
                        processed_faces.append(face_result)
                        continue

                    # Rule 5C: Identity consensus (prevent transient cross-identity switching)
                    consensus_ratio = face.get("identity_consensus_ratio", 1.0)
                    min_consensus_ratio = current_app.config.get("TRACK_IDENTITY_CONSENSUS_RATIO", 0.60) if current_app else 0.60
                    if consensus_ratio < min_consensus_ratio:
                        face_result["action_status"] = "UNCERTAIN_TRACK"
                        face_result["message"] = (
                            f"Identity conflict across track ({int(consensus_ratio*100)}% consensus). "
                            "Please step forward individually."
                        )
                        processed_faces.append(face_result)
                        continue

                    # Rule 5D: Track average match score stability
                    avg_score = face.get("average_match_score", score)
                    if avg_score < match_thresh:
                        face_result["action_status"] = "UNCERTAIN_TRACK"
                        face_result["message"] = (
                            f"Track average match score ({avg_score:.3f}) below threshold ({match_thresh:.3f})."
                        )
                        processed_faces.append(face_result)
                        continue

                    # Rule 5E: Track duration threshold
                    track_duration = face.get("track_duration_sec", 0.0)
                    if min_duration_sec > 0 and track_duration < min_duration_sec:
                        face_result["action_status"] = "ACQUIRING_TRACK"
                        face_result["message"] = (
                            f"Confirming optical transit duration ({track_duration:.2f}s/{min_duration_sec:.2f}s)..."
                        )
                        processed_faces.append(face_result)
                        continue

                    # Rule 5F: Multi-frame Liveness / Anti-spoofing consensus
                    if not face.get("is_confirmed_live", True):
                        face_result["action_status"] = "SPOOF_BLOCKED"
                        face_result["message"] = "Multi-frame liveness verification failed across trajectory."
                        processed_faces.append(face_result)
                        continue

                # If this track already punched during this physical pass-through, prevent re-fire (live camera mode)
                if not is_simulation and is_punch_committed:
                    face_result["action_status"] = "ALREADY_PUNCHED_IN_PASSAGE"
                    face_result["message"] = f"{emp_info.get('full_name')} passage already authorized (Track #{track_id})."
                    processed_faces.append(face_result)
                    continue

                # 6. Physical Passage Direction & Gating Validation
                open_sess = get_open_session_for_employee(emp_id)

                # Rule: Dedicated physical IN gate ONLY does CHECK_IN
                if gate_mode == "IN" or station.station_code.endswith("-IN"):
                    if open_sess:
                        face_result["action_status"] = "ALREADY_CHECKED_IN"
                        face_result["attendance_action"] = "CHECK_IN"
                        face_result["message"] = f"{emp_info.get('full_name')} already has an open check-in session."
                        processed_faces.append(face_result)
                        continue
                    action = "CHECK_IN"

                # Rule: Dedicated physical OUT gate ONLY does CHECK_OUT
                elif gate_mode == "OUT" or station.station_code.endswith("-OUT"):
                    if not open_sess:
                        face_result["action_status"] = "NO_OPEN_SESSION"
                        face_result["attendance_action"] = "CHECK_OUT"
                        face_result["message"] = f"No open check-in session found for {emp_info.get('full_name')}."
                        processed_faces.append(face_result)
                        continue
                    action = "CHECK_OUT"

                elif gate_mode == "BIDIRECTIONAL":
                    # Bidirectional doorway trajectory mode:
                    if not is_simulation:
                        if motion_dir == "STATIONARY":
                            face_result["action_status"] = "STATIONARY_LINGER"
                            face_result["message"] = f"{emp_info.get('full_name')} is stationary at the gate. Step forward to record passage."
                            processed_faces.append(face_result)
                            continue
                        elif motion_dir == "RECEDING":
                            if not open_sess:
                                face_result["action_status"] = "NO_OPEN_SESSION"
                                face_result["attendance_action"] = "CHECK_OUT"
                                face_result["message"] = f"No open check-in session found for {emp_info.get('full_name')}."
                                processed_faces.append(face_result)
                                continue
                            action = "CHECK_OUT"
                        else:  # APPROACHING
                            if open_sess:
                                face_result["action_status"] = "ALREADY_CHECKED_IN"
                                face_result["attendance_action"] = "CHECK_IN"
                                face_result["message"] = f"{emp_info.get('full_name')} already has an open check-in session."
                                processed_faces.append(face_result)
                                continue
                            action = "CHECK_IN"
                    else:
                        action = "CHECK_OUT" if open_sess else "CHECK_IN"

                else:
                    # AUTO_DETECT mode: intelligently disambiguate CHECK_IN vs CHECK_OUT
                    # and actively protect against accidental checkout
                    if not open_sess:
                        # No active attendance session: passage indicates campus arrival (CHECK_IN)
                        has_motion_signal = (not is_simulation) or ("motion_direction" in frame_payload)
                        if has_motion_signal and motion_dir == "STATIONARY":
                            face_result["action_status"] = "STATIONARY_LINGER"
                            face_result["message"] = f"{emp_info.get('full_name')} is stationary near gate. Step forward to register check-in."
                            processed_faces.append(face_result)
                            continue
                        action = "CHECK_IN"
                    else:
                        # Open attendance session exists. Evaluate guards before allowing automated CHECK_OUT:
                        is_forced_checkout = (
                            frame_payload.get("force_action") == "CHECK_OUT"
                            or frame_payload.get("intent") == "CHECK_OUT"
                        )

                        if not is_forced_checkout:
                            # Guard 1: Enforce minimum active session duration to prevent rapid flip-flop checkout
                            check_in_time = (
                                open_sess.check_in_event.occurred_at
                                if (open_sess.check_in_event and open_sess.check_in_event.occurred_at)
                                else open_sess.created_at
                            )
                            if check_in_time:
                                if check_in_time.tzinfo is not None:
                                    check_in_time = check_in_time.replace(tzinfo=None)
                                now_naive = now.replace(tzinfo=None) if now.tzinfo is not None else now
                                elapsed_sec = (now_naive - check_in_time).total_seconds()
                            else:
                                elapsed_sec = 0

                            min_checkout_elapsed_mins = cfg.get(
                                "min_checkout_elapsed_mins",
                                current_app.config.get("MIN_AUTO_CHECKOUT_ELAPSED_MINUTES", 15) if current_app else 15
                            )
                            min_checkout_elapsed_sec = min_checkout_elapsed_mins * 60

                            if elapsed_sec < min_checkout_elapsed_sec:
                                face_result["action_status"] = "ALREADY_CHECKED_IN"
                                face_result["attendance_action"] = "CHECK_IN"
                                elapsed_mins_display = max(1, int(elapsed_sec // 60))
                                face_result["message"] = (
                                    f"{emp_info.get('full_name')} is currently checked in "
                                    f"(session active {elapsed_mins_display}m). "
                                    "Premature auto-checkout blocked to prevent accidental departure."
                                )
                                processed_faces.append(face_result)
                                continue

                            # Guard 2: Motion trajectory validation
                            has_motion_signal = (not is_simulation) or ("motion_direction" in frame_payload)
                            if has_motion_signal:
                                if motion_dir == "STATIONARY":
                                    face_result["action_status"] = "STATIONARY_LINGER"
                                    face_result["message"] = (
                                        f"{emp_info.get('full_name')} is stationary near gate. "
                                        "Step forward to register departure."
                                    )
                                    processed_faces.append(face_result)
                                    continue
                                elif motion_dir == "APPROACHING":
                                    face_result["action_status"] = "ALREADY_CHECKED_IN"
                                    face_result["attendance_action"] = "CHECK_IN"
                                    face_result["message"] = (
                                        f"{emp_info.get('full_name')} is approaching gate with active session. "
                                        "Auto-checkout withheld for entry trajectory."
                                    )
                                    processed_faces.append(face_result)
                                    continue

                        # All guards passed or forced checkout: authorize automated departure
                        action = "CHECK_OUT"

                # 7. Atomic Attendance Event Recording
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
                    tracker.mark_punch_committed(track_id, action, result.get("event_id", ""))
                    face_result["is_punch_committed"] = True
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
                            "track_id": track_id,
                            "motion_direction": motion_dir,
                            "frames_seen": frames_seen,
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

            elif status == "CONSENT_NOT_VERIFIED":
                face_result["action_status"] = "CONSENT_BLOCKED"
                face_result["message"] = (
                    f"Biometric consent not verified for {emp_info.get('full_name') if emp_info else 'employee'}. "
                    "Autonomous passage blocked per college privacy policy."
                )

            processed_faces.append(face_result)

        latency_ms = round((time.perf_counter() - start_time) * 1000, 1)

        # 8. Operational Telemetry & Health Monitoring
        telemetry = {
            "fps": round(1000.0 / max(1.0, latency_ms), 1),
            "inference_ms": latency_ms,
            "active_tracks": len(tracker.active_tracks),
            "camera_status": station.camera_status or "ONLINE",
            "model_pipeline": {
                "detector": "UltraFace-RFB-320 ONNX",
                "recognizer": "SFace-2021dec ONNX 128-D",
                "tracker": "ContinuousMultiFaceTracker-Centroid-IoU",
                "pad_liveness": "Multi-factor Chrominance-Laplacian-Moiré",
            },
        }

        return {
            "station_code": station.station_code,
            "station_name": station.name,
            "gate_mode": gate_mode,
            "timestamp": now.isoformat(),
            "timestamp_eat": utc_to_local(now).strftime("%Y-%m-%d %H:%M:%S"),
            "faces_detected": len(processed_faces),
            "faces": processed_faces,
            "summary_actions": action_summaries,
            "telemetry": telemetry,
        }

    def _record_passage(self, station_code: str, passage: dict):
        code = (station_code or "").upper().strip()
        if code not in self._recent_passages:
            self._recent_passages[code] = []
        self._recent_passages[code].insert(0, passage)
        if len(self._recent_passages[code]) > 40:
            self._recent_passages[code] = self._recent_passages[code][:40]

    def get_gate_status(self, station: AttendanceStation) -> dict:
        """Get live stream status, throughput metrics, operational health, and recent gate passages."""
        code = station.station_code
        cfg = self.get_gate_config(code)
        recent = self._recent_passages.get(code, [])
        tracker = self.get_tracker(code)

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
            "camera_status": station.camera_status or "ONLINE",
            "last_heartbeat": station.last_heartbeat.isoformat() if station.last_heartbeat else None,
            "gate_mode": cfg.get("gate_mode", "AUTO_DETECT"),
            "cooldown_sec": cfg.get("cooldown_sec", 20),
            "min_checkout_elapsed_mins": cfg.get("min_checkout_elapsed_mins", 15),
            "min_persistence_frames": cfg.get("min_persistence_frames", 3),
            "today_total_passages": len(today_events),
            "today_checkins": check_ins,
            "today_checkouts": check_outs,
            "active_tracks_count": len(tracker.active_tracks),
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
