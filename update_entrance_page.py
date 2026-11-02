import os

file_path = os.path.join("frontend", "src", "app", "entrance", "page.tsx")
with open(file_path, "r", encoding="utf-8") as f:
    text = f.read()

old_status_block = """      if (face.action_status === "COOLDOWN_ACTIVE") {
        strokeColor = "#f59e0b"; // amber
        fillColor = "rgba(245, 158, 11, 0.12)";
        tagText = "COOLDOWN (PASSAGE LOGGED)";
      } else if (face.status === "UNKNOWN_FACE" || face.action_status === "UNKNOWN_VISITOR") {
        strokeColor = "#f43f5e"; // rose
        fillColor = "rgba(244, 63, 94, 0.15)";
        tagText = "UNKNOWN VISITOR";
      } else if (face.status === "UNCERTAIN_MATCH") {
        strokeColor = "#eab308"; // yellow
        fillColor = "rgba(234, 179, 8, 0.12)";
        tagText = "UNCERTAIN CANDIDATE";
      }"""

new_status_block = """      if (face.action_status === "COOLDOWN_ACTIVE") {
        strokeColor = "#f59e0b"; // amber
        fillColor = "rgba(245, 158, 11, 0.12)";
        tagText = "COOLDOWN (PASSAGE LOGGED)";
      } else if (face.action_status === "ACQUIRING_TRACK") {
        strokeColor = "#0284c7"; // sky blue
        fillColor = "rgba(2, 132, 199, 0.12)";
        tagText = `TRACKING (${face.frames_seen || 1}/2 FRAMES)`;
      } else if (face.action_status === "ALREADY_PUNCHED_IN_PASSAGE") {
        strokeColor = "#059669"; // green
        fillColor = "rgba(5, 150, 105, 0.12)";
        tagText = "PASSAGE AUTHORIZED";
      } else if (face.action_status === "SPOOF_BLOCKED") {
        strokeColor = "#dc2626"; // red
        fillColor = "rgba(220, 38, 38, 0.22)";
        tagText = "SPOOF ATTACK BLOCKED";
      } else if (face.action_status === "STATIONARY_LINGER") {
        strokeColor = "#7c3aed"; // violet
        fillColor = "rgba(124, 58, 237, 0.12)";
        tagText = "STEP FORWARD TO REGISTER";
      } else if (face.action_status === "ALREADY_CHECKED_IN") {
        strokeColor = "#0891b2"; // cyan
        fillColor = "rgba(8, 145, 178, 0.12)";
        tagText = "ALREADY CHECKED IN";
      } else if (face.action_status === "NO_OPEN_SESSION") {
        strokeColor = "#db2777"; // pink
        fillColor = "rgba(219, 39, 119, 0.12)";
        tagText = "NO OPEN SESSION (CANNOT EXIT)";
      } else if (face.status === "UNKNOWN_FACE" || face.action_status === "UNKNOWN_VISITOR") {
        strokeColor = "#f43f5e"; // rose
        fillColor = "rgba(244, 63, 94, 0.15)";
        tagText = "UNKNOWN VISITOR";
      } else if (face.status === "UNCERTAIN_MATCH") {
        strokeColor = "#eab308"; // yellow
        fillColor = "rgba(234, 179, 8, 0.12)";
        tagText = "UNCERTAIN CANDIDATE";
      }"""

old_sub = """      const sub = face.employee
        ? `${face.employee.employee_number} • ${Math.round(face.recognition_score * 100)}% Match`
        : `Face Track #${face.track_id}`;"""

new_sub = """      const sub = face.employee
        ? `${face.employee.employee_number} • ${Math.round(face.recognition_score * 100)}% • ${face.motion_direction || "APPROACHING"}`
        : `Track #${face.track_id} • ${face.motion_direction || "ACQUIRING"}`;"""

text_crlf = "\r\n" in text
old_status_norm = old_status_block.replace("\n", "\r\n") if text_crlf else old_status_block
new_status_norm = new_status_block.replace("\n", "\r\n") if text_crlf else new_status_block
old_sub_norm = old_sub.replace("\n", "\r\n") if text_crlf else old_sub
new_sub_norm = new_sub.replace("\n", "\r\n") if text_crlf else new_sub

assert old_status_norm in text, "old_status_norm not found"
text = text.replace(old_status_norm, new_status_norm, 1)

assert old_sub_norm in text, "old_sub_norm not found"
text = text.replace(old_sub_norm, new_sub_norm, 1)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(text)

print("entrance/page.tsx updated successfully!")
