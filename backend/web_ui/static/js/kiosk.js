/**
 * Departmental Attendance Station Kiosk Controller (Screen 1)
 *  - Journey A: Check-In  (scan -> server recognizes -> employee explicitly confirms)
 *  - Journey B: Check-Out (server validates the open session; event type is never changed silently)
 *  - Journey C: Unknown face -> neutral retry message -> optional HR assistance request
 *
 * The station identity travels in the signed, HTTP-only binding cookie set during admin
 * provisioning, so this script never sees or sends station secrets. Confirmation sends the
 * short-lived recognition token returned by the scan, not a client-chosen employee identity.
 */

let currentCandidate = null;
let requestInFlight = false;
let cameraMirrored = true;

function initCameraMirrorState() {
  try {
    const saved = localStorage.getItem("kiosk_camera_mirrored");
    cameraMirrored = saved !== "false";
  } catch (e) {
    cameraMirrored = true;
  }
  applyCameraMirrorState();
}

function applyCameraMirrorState() {
  const videoEl = document.getElementById("kiosk-video");
  const toggleBtn = document.getElementById("camera-mirror-toggle");
  if (videoEl) {
    if (cameraMirrored) {
      videoEl.classList.remove("unmirrored");
      videoEl.classList.add("mirrored");
    } else {
      videoEl.classList.remove("mirrored");
      videoEl.classList.add("unmirrored");
    }
  }
  if (toggleBtn) {
    toggleBtn.textContent = cameraMirrored ? "🪞 Mirror: ON" : "📷 Mirror: OFF";
    toggleBtn.setAttribute("aria-pressed", cameraMirrored ? "true" : "false");
  }
}

function toggleCameraMirror() {
  cameraMirrored = !cameraMirrored;
  try {
    localStorage.setItem("kiosk_camera_mirrored", cameraMirrored ? "true" : "false");
  } catch (e) { /* ignore storage errors */ }
  applyCameraMirrorState();
}
window.toggleCameraMirror = toggleCameraMirror;

async function startCameraPreview() {
  const videoEl = document.getElementById("kiosk-video");
  const statusEl = document.getElementById("camera-conn-badge");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = "CAMERA API UNAVAILABLE";
    statusEl.className = "badge badge-danger";
    return;
  }
  try {
    videoEl.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    statusEl.textContent = "CAMERA ONLINE";
    statusEl.className = "badge badge-success";
  } catch (err) {
    statusEl.textContent = "CAMERA OFFLINE";
    statusEl.className = "badge badge-danger";
  }
}

function captureWebcamFrame() {
  const videoEl = document.getElementById("kiosk-video");
  if (!videoEl || !videoEl.srcObject || videoEl.readyState < 2) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 320;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (cameraMirrored) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(videoEl, 0, 0, 320, 320);
  return canvas.toDataURL("image/jpeg", 0.9);
}

function buildScanPayload(scanMode) {
  if (scanMode === "WEBCAM_FRAME") {
    const frame = captureWebcamFrame();
    return frame ? { image_base64: frame } : null;
  }
  // Simulation-only presets (server ignores these unless ALLOW_SIMULATED_BIOMETRICS is on).
  const selectEl = document.getElementById("sim-employee-select");
  const empNum = selectEl ? selectEl.value : "";
  const presets = {
    ENROLLED:   { biometric_signature: "FACE_SIG_" + empNum, quality_metrics: { brightness: 135, sharpness: 92, face_detected: true } },
    UNKNOWN:    { biometric_signature: "FACE_SIG_UNREGISTERED_VISITOR", quality_metrics: { brightness: 130, sharpness: 88, face_detected: true } },
    POOR_LIGHT: { biometric_signature: "FACE_SIG_" + empNum, quality_metrics: { brightness: 20, sharpness: 85, face_detected: true } },
    OBSTRUCTED: { biometric_signature: "FACE_SIG_" + empNum, quality_metrics: { brightness: 120, sharpness: 25, face_detected: false, obstructed: true } },
  };
  return presets[scanMode] || null;
}

async function postJson(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await resp.json(); } catch (e) { /* non-JSON error */ }
  return { resp, data };
}

/** Step 1: capture and recognize (never records attendance). */
async function performStationScan(scanMode) {
  if (requestInFlight) return;
  const payload = buildScanPayload(scanMode);
  if (!payload) {
    setScanStatus("The camera is not ready. Please wait a moment and try again.", "danger");
    return;
  }
  requestInFlight = true;
  hideOutcome();
  setScanStatus("Checking image quality and identity…", "info");
  try {
    const { data } = await postJson("/api/station/scan", payload);
    renderRecognitionOutcome(data);
  } catch (e) {
    setScanStatus("Cannot reach the attendance server. No attendance was recorded.", "danger");
  } finally {
    requestInFlight = false;
  }
}

function renderRecognitionOutcome(data) {
  const panel = document.getElementById("kiosk-decision-panel");
  const matchedBox = document.getElementById("matched-identity-box");
  const retryBox = document.getElementById("unknown-retry-box");

  if (data.matched && data.employee && data.recognition_token) {
    currentCandidate = {
      employee_id: data.employee.id,
      employee_number: data.employee.employee_number,
      recognition_token: data.recognition_token,
    };
    panel.className = "confirmation-panel matched";
    retryBox.style.display = "none";
    matchedBox.style.display = "block";

    document.getElementById("cand-name").textContent = data.employee.full_name;
    document.getElementById("cand-emp-num").textContent = data.employee.employee_number;
    document.getElementById("cand-dept").textContent = data.employee.department;
    document.getElementById("cand-shift").textContent = data.assigned_shift
      ? data.assigned_shift.name + " [" + data.assigned_shift.ethiopian_display + "]"
      : "No shift assigned";

    const badge = document.getElementById("cand-session-badge");
    if (data.open_session) {
      badge.textContent = "Checked in at " + data.open_session.check_in_local;
      badge.className = "badge badge-warning";
    } else {
      badge.textContent = "Not checked in";
      badge.className = "badge badge-info";
    }
    setScanStatus("Identity found. Please confirm Check-In or Check-Out.", "success");
    return;
  }

  // Neutral failure: never expose a candidate identity or biometric detail (Journey C).
  currentCandidate = null;
  panel.className = "confirmation-panel rejected";
  matchedBox.style.display = "none";
  retryBox.style.display = "block";
  const msg = data.message || data.error || "We could not confirm your identity. No attendance was recorded.";
  document.getElementById("retry-message-text").textContent = msg;
  setScanStatus(msg, "danger");
}

/** Step 2: explicit employee confirmation. */
async function confirmEmployeeAttendance(eventType) {
  if (!currentCandidate || requestInFlight) return;
  requestInFlight = true;
  setConfirmButtonsDisabled(true);
  try {
    const { resp, data } = await postJson("/api/station/confirm", {
      employee_id: currentCandidate.employee_id,
      event_type: eventType,
      recognition_token: currentCandidate.recognition_token,
    });
    if (resp.ok && data.recorded) {
      const a = data.attendance;
      showOutcome("success",
        "<strong>✔ " + (a.event_type === "CHECK_IN" ? "Checked in" : "Checked out") + "</strong><br>" +
        escapeHtml(a.employee_name) + " (" + escapeHtml(a.employee_number) + ")<br>" +
        "Recorded at <strong>" + escapeHtml(a.occurred_at_local) + " EAT</strong> · Station " + escapeHtml(a.station_code) +
        (a.event_type === "CHECK_IN"
          ? " · <span class='badge badge-info'>" + escapeHtml(a.arrival_status) + (a.late_minutes > 0 ? " (" + a.late_minutes + " min late)" : "") + "</span>"
          : ""));
      currentCandidate = null;
      document.getElementById("matched-identity-box").style.display = "none";
    } else {
      let html = "<strong>✖ Not recorded</strong><br>" + escapeHtml(data.error || "The action could not be completed.");
      if (data.recovery_available) {
        html += "<div style='margin-top:0.6rem;'><button type='button' class='btn btn-warning btn-sm' " +
          "onclick=\"submitStationReviewRequest('INVALID_CHECKOUT_ATTEMPT', '" + eventType + "')\">Ask HR to Review</button></div>";
      }
      showOutcome("danger", html);
    }
  } catch (e) {
    showOutcome("danger", "Cannot reach the attendance server. <strong>No attendance was recorded.</strong>");
  } finally {
    requestInFlight = false;
    setConfirmButtonsDisabled(false);
  }
}

/** Journeys B & C: queue a case for HR review. */
async function submitStationReviewRequest(caseType, intendedAction) {
  const claimedEl = document.getElementById("claimed-emp-number");
  const reasonEl = document.getElementById("assistance-reason");
  const claimed = (claimedEl && claimedEl.value) || (currentCandidate ? currentCandidate.employee_number : "");
  const reason = (reasonEl && reasonEl.value) || ("Employee requested HR assistance (" + caseType + ")");
  try {
    const { data } = await postJson("/api/station/request-review", {
      case_type: caseType,
      intended_action: intendedAction,
      claimed_employee_number: claimed,
      candidate_employee_id: currentCandidate ? currentCandidate.employee_id : null,
      reason: reason,
    });
    showOutcome("info", "<strong>📋 Request sent to HR</strong><br>" + escapeHtml(data.message || data.error || ""));
  } catch (e) {
    showOutcome("danger", "Cannot reach the attendance server. Please contact HR directly.");
  }
}

function resetKioskScan() {
  currentCandidate = null;
  document.getElementById("matched-identity-box").style.display = "none";
  document.getElementById("unknown-retry-box").style.display = "none";
  document.getElementById("kiosk-decision-panel").className = "confirmation-panel";
  hideOutcome();
  setScanStatus("Position your face inside the green oval and press Scan.", "info");
}

function setConfirmButtonsDisabled(disabled) {
  ["btn-check-in", "btn-check-out"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function showOutcome(level, html) {
  const box = document.getElementById("recorded-outcome-box");
  box.className = "alert alert-" + level;
  box.innerHTML = html;
  box.style.display = "block";
}

function hideOutcome() {
  document.getElementById("recorded-outcome-box").style.display = "none";
}

function setScanStatus(msg, level) {
  const el = document.getElementById("scan-progress-banner");
  if (!el) return;
  el.textContent = msg;
  el.className = "alert alert-" + level;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

document.addEventListener("DOMContentLoaded", () => {
  initCameraMirrorState();
  if (document.getElementById("kiosk-video")) startCameraPreview();
});
