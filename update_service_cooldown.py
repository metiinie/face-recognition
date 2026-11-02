import os

file_path = os.path.join("backend", "continuous_entrance", "service.py")
with open(file_path, "r", encoding="utf-8") as f:
    text = f.read()

target = """                # 4. Multi-Frame Tracking Persistence (Prevents False Automatic Attendance)
                # In live camera mode, require at least 2 frames of persistent track before punch
                if not is_simulation and frames_seen < 2 and not is_punch_committed:
                    face_result["action_status"] = "ACQUIRING_TRACK"
                    face_result["message"] = f"Tracking {emp_info.get('full_name')} (Acquiring persistence {frames_seen}/2)..."
                    processed_faces.append(face_result)
                    continue

                # If this track already punched during this physical pass-through, prevent re-fire
                if is_punch_committed:
                    face_result["action_status"] = "ALREADY_PUNCHED_IN_PASSAGE"
                    face_result["message"] = f"{emp_info.get('full_name')} passage already authorized (Track #{track_id})."
                    processed_faces.append(face_result)
                    continue

                # 5. Database-Level Duplicate & Replay Protection
                # Check memory cache first
                in_cooldown = False
                remaining_sec = 0
                if last_time and (now - last_time).total_seconds() < cooldown_sec:
                    in_cooldown = True
                    remaining_sec = int(cooldown_sec - (now - last_time).total_seconds())

                if not in_cooldown:
                    # Database-level verification across workers / restarts
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
                    continue"""

replacement = """                # 4. Temporal Cooldown & Database-Level Anti-Replay Protection
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

                # 5. Multi-Frame Tracking Persistence (Prevents False Automatic Attendance)
                # In live camera mode, require at least 2 frames of persistent track before punch
                if not is_simulation and frames_seen < 2 and not is_punch_committed:
                    face_result["action_status"] = "ACQUIRING_TRACK"
                    face_result["message"] = f"Tracking {emp_info.get('full_name')} (Acquiring persistence {frames_seen}/2)..."
                    processed_faces.append(face_result)
                    continue

                # If this track already punched during this physical pass-through, prevent re-fire (live camera mode)
                if not is_simulation and is_punch_committed:
                    face_result["action_status"] = "ALREADY_PUNCHED_IN_PASSAGE"
                    face_result["message"] = f"{emp_info.get('full_name')} passage already authorized (Track #{track_id})."
                    processed_faces.append(face_result)
                    continue"""

text_crlf = "\r\n" in text
target_norm = target.replace("\n", "\r\n") if text_crlf else target
replacement_norm = replacement.replace("\n", "\r\n") if text_crlf else replacement

assert target_norm in text, "target_norm not found in service.py"
text = text.replace(target_norm, replacement_norm, 1)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(text)

print("service.py cooldown ordering updated successfully!")
