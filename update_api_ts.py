import os

file_path = os.path.join("frontend", "src", "lib", "api.ts")
with open(file_path, "r", encoding="utf-8") as f:
    text = f.read()

target = """  action_status: "CONFIRMED" | "COOLDOWN_ACTIVE" | "ALREADY_CHECKED_IN" | "NO_OPEN_SESSION" | "UNKNOWN_VISITOR" | "REJECTED" | string;
  attendance_action?: "CHECK_IN" | "CHECK_OUT" | null;
  session_id?: number | null;
  is_late?: boolean;
  minutes_late?: number;
  message?: string;
  review_case_id?: number;
}"""

replacement = """  action_status: "CONFIRMED" | "COOLDOWN_ACTIVE" | "ALREADY_CHECKED_IN" | "NO_OPEN_SESSION" | "UNKNOWN_VISITOR" | "REJECTED" | "ACQUIRING_TRACK" | "ALREADY_PUNCHED_IN_PASSAGE" | "SPOOF_BLOCKED" | "STATIONARY_LINGER" | string;
  attendance_action?: "CHECK_IN" | "CHECK_OUT" | null;
  session_id?: number | null;
  is_late?: boolean;
  minutes_late?: number;
  message?: string;
  review_case_id?: number;
  spoof_detected?: boolean;
  spoof_type?: string | null;
  frames_seen?: number;
  motion_direction?: "APPROACHING" | "RECEDING" | "STATIONARY" | string;
  is_punch_committed?: boolean;
}"""

target2 = """  faces_detected: number;
  faces: ContinuousFaceResult[];
  summary_actions: string[];
}"""

replacement2 = """  faces_detected: number;
  faces: ContinuousFaceResult[];
  summary_actions: string[];
  telemetry?: {
    fps: number;
    inference_ms: number;
    active_tracks: number;
    camera_status: string;
    model_pipeline?: {
      detector: string;
      recognizer: string;
      tracker: string;
      pad_liveness: string;
    };
  };
}"""

text_crlf = "\r\n" in text
target_norm = target.replace("\n", "\r\n") if text_crlf else target
replacement_norm = replacement.replace("\n", "\r\n") if text_crlf else replacement
target2_norm = target2.replace("\n", "\r\n") if text_crlf else target2
replacement2_norm = replacement2.replace("\n", "\r\n") if text_crlf else replacement2

assert target_norm in text, "target not found"
text = text.replace(target_norm, replacement_norm, 1)

assert target2_norm in text, "target2 not found"
text = text.replace(target2_norm, replacement2_norm, 1)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(text)

print("api.ts updated successfully!")
