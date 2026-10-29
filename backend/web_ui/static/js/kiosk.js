/**
 * Departmental Attendance Station Kiosk Controller (Screen 1)
 * Implements:
 *  - Journey A: Employee Check-In (Two-step: Recognize -> Explicit Employee Confirmation)
 *  - Journey B: Employee Check-Out (Validates open session; never silently changes event type)
 *  - Journey C: Unknown Face / Failed Recognition -> Neutral Retry & HR Review Request
 */

let currentCandidate = null;
let confirmInProgress = false;
let mediaStream = null;

async function startCameraPreview() {
  const videoEl = document.getElementById("kiosk-video");
  const statusEl = document.getElementById("camera-conn-badge");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (statusEl) statusEl.textContent = "SIMULATION READY (No Webcam API)";
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    videoEl.srcObject = mediaStream;
    if (statusEl) {
      statusEl.textContent = "LIVE WEBCAM ONLINE";
      statusEl.className = "badge badge-success";
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = "KIOSK SIMULATOR MODE ACTIVE";
      statusEl.className = "badge badge-info";
    }
  }
}

function getStationContext() {
  const codeEl = document.getElementById("station-code-input");
  const tokenEl = document.getElementById("station-token-input");
  return {
    station_code: codeEl ? codeEl.value : "",
    station_token: tokenEl ? tokenEl.value : "",
  };
}

/**
 * Step 1: Capture and Recognize Face (Does NOT record attendance!)
 */
async function performStationScan(scanMode) {
  const st = getStationContext();
  const selectEmp = document.getElementById("sim-employee-select");
  const selectedEmpNum = selectEmp ? selectEmp.value : "EIPC-EMP-001";

  const payload = {
    station_code: st.station_code,
    station_token: st.station_token,
  };

  if (scanMode === "ENROLLED") {
    payload.biometric_signature = "FACE_SIG_" + selectedEmpNum;
    payload.quality_metrics = { brightness: 135.0, sharpness: 92.0, face_detected: TrueBool(true) };
  } else if (scanMode === "UNKNOWN") {
    payload.biometric_signature = "FACE_SIG_UNREGISTERED_VISITOR_999";
    payload.quality_metrics = { brightness: 130.0, sharpness: 88.0, face_detected: TrueBool(true) };
  } else if (scanMode === "POOR_LIGHT") {
    payload.biometric_signature = "FACE_SIG_" + selectedEmpNum;
    payload.quality_metrics = { brightness: 20.0, sharpness: 85.0, face_detected: TrueBool(true) };
  } else if (scanMode === "OBSTRUCTED") {
    payload.biometric_signature = "FACE_SIG_" + selectedEmpNum;
    payload.quality_metrics = { brightness: 120.0, sharpness: 25.0, face_detected: false, obstructed: true };
  } else if (scanMode === "WEBCAM_FRAME") {
    const videoEl = document.getElementById("kiosk-video");
    if (videoEl && videoEl.srcObject) {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 160;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(videoEl, 0, 0, 160, 160);
      payload.image_base64 = canvas.toDataURL("image/jpeg", 0.85);
    } else {
      payload.biometric_signature = "FACE_SIG_" + selectedEmpNum;
      payload.quality_metrics = { brightness: 135.0, sharpness: 92.0, face_detected: true };
    }
  }

  setScanStatus("Scanning & verifying face quality...", "info");

  try {
    const resp = await fetch("/api/station/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    renderRecognitionOutcome(data, payload.biometric_signature);
  } catch (e) {
    setScanStatus("Network error communicating with attendance server.", "danger");
  }
}

function TrueBool(v) { return Boolean(v); }

function renderRecognitionOutcome(data, usedSignature) {
  const panel = document.getElementById("kiosk-decision-panel");
  const matchedBox = document.getElementById("matched-identity-box");
  const retryBox = document.getElementById("unknown-retry-box");
  const outcomeBox = document.getElementById("recorded-outcome-box");

  if (outcomeBox) outcomeBox.style.display = "none";

  if (data.error) {
    panel.className = "confirmation-panel rejected";
    matchedBox.style.display = "none";
    retryBox.style.display = "block";
    document.getElementById("retry-message-text").textContent = data.error;
    return;
  }

  if (data.matched && data.employee) {
    currentCandidate = {
      employee_id: data.employee.id,
      employee_number: data.employee.employee_number,
      full_name: data.employee.full_name,
      recognition_score: data.recognition_score,
      biometric_signature: usedSignature,
    };
    panel.className = "confirmation-panel matched";
    retryBox.style.display = "none";
    matchedBox.style.display = "block";

    document.getElementById("cand-name").textContent = data.employee.full_name;
    document.getElementById("cand-emp-num").textContent = data.employee.employee_number;
    document.getElementById("cand-dept").textContent = data.employee.department + " (" + data.employee.job_category + ")";
    document.getElementById("cand-score").textContent = (data.recognition_score * 100).toFixed(1) + "% (Quality: " + (data.quality_score * 100).toFixed(0) + "%)";

    if (data.assigned_shift) {
      document.getElementById("cand-shift").textContent =
        data.assigned_shift.name + " [" + data.assigned_shift.ethiopian_display + "]";
    } else {
      document.getElementById("cand-shift").textContent = "Standard Shift";
    }

    if (data.open_session) {
      document.getElementById("cand-session-badge").textContent =
        "OPEN SESSION (Checked in at " + data.open_session.check_in_local + ")";
      document.getElementById("cand-session-badge").className = "badge badge-warning";
    } else {
      document.getElementById("cand-session-badge").textContent = "NO OPEN SESSION (Ready for Check-In)";
      document.getElementById("cand-session-badge").className = "badge badge-info";
    }
    setScanStatus(data.message, "success");
  } else {
    currentCandidate = null;
    panel.className = "confirmation-panel rejected";
    matchedBox.style.display = "none";
    retryBox.style.display = "block";
    document.getElementById("retry-status-badge").textContent = data.status || "REJECTED";
    document.getElementById("retry-message-text").textContent = data.message;
    setScanStatus(data.message, "danger");
  }
}

/**
 * Step 2: Explicit Employee Confirmation (Check-In or Check-Out)
 */
async function confirmEmployeeAttendance(eventType) {
  if (!currentCandidate || confirmInProgress) return;
  confirmInProgress = true;

  const st = getStationContext();
  const outcomeBox = document.getElementById("recorded-outcome-box");

  try {
    const resp = await fetch("/api/station/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        station_code: st.station_code,
        station_token: st.station_token,
        employee_id: currentCandidate.employee_id,
        event_type: eventType,
        recognition_score: currentCandidate.recognition_score,
        biometric_signature: currentCandidate.biometric_signature,
      }),
    });
    const data = await resp.json();
    outcomeBox.style.display = "block";

    if (resp.ok && data.recorded) {
      outcomeBox.className = "alert alert-success";
      outcomeBox.innerHTML =
        "<strong>✔ Attendance Recorded (" + data.attendance.event_type + ")</strong><br>" +
        "Employee: " + data.attendance.employee_name + " (" + data.attendance.employee_number + ")<br>" +
        "Recorded Time: <strong>" + data.attendance.occurred_at_local + " EAT</strong> | " +
        "Station: " + data.attendance.station_code + " | " +
        "Punctuality: <span class='badge badge-info'>" + data.attendance.arrival_status +
        (data.attendance.late_minutes > 0 ? " (" + data.attendance.late_minutes + "m late)" : "") + "</span>";
    } else {
      outcomeBox.className = "alert alert-danger";
      outcomeBox.innerHTML =
        "<strong>✖ Action Rejected (" + (data.error_code || "INVALID_ACTION") + ")</strong><br>" +
        (data.error || "Unable to complete action.") +
        (data.recovery_available
          ? "<div style='margin-top:0.6rem;'><button type='button' class='btn btn-warning btn-sm' onclick=\"submitStationReviewRequest('INVALID_CHECKOUT_ATTEMPT', '" +
            eventType + "')\">Request Authorized HR Review</button></div>"
          : "");
    }
  } catch (e) {
    outcomeBox.style.display = "block";
    outcomeBox.className = "alert alert-danger";
    outcomeBox.textContent = "Server communication failure. No attendance event was recorded.";
  } finally {
    confirmInProgress = false;
  }
}

/**
 * Journey B & C: Request HR Assistance / Review Case
 */
async function submitStationReviewRequest(caseType, intendedAction) {
  const st = getStationContext();
  const claimedNumEl = document.getElementById("claimed-emp-number");
  const claimedNum = claimedNumEl && claimedNumEl.value
    ? claimedNumEl.value
    : (currentCandidate ? currentCandidate.employee_number : "");
  const reasonEl = document.getElementById("assistance-reason");
  const reason = (reasonEl && reasonEl.value)
    ? reasonEl.value
    : ("Employee requested HR review at station " + st.station_code + " (" + caseType + ")");

  const outcomeBox = document.getElementById("recorded-outcome-box");
  const resp = await fetch("/api/station/request-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      station_code: st.station_code,
      station_token: st.station_token,
      case_type: caseType,
      intended_action: intendedAction,
      claimed_employee_number: claimedNum,
      candidate_employee_id: currentCandidate ? currentCandidate.employee_id : null,
      reason: reason,
    }),
  });
  const data = await resp.json();
  outcomeBox.style.display = "block";
  outcomeBox.className = "alert alert-info";
  outcomeBox.innerHTML = "<strong>📋 HR Review Request Logged</strong><br>" + (data.message || data.error);
}

function resetKioskScan() {
  currentCandidate = null;
  document.getElementById("matched-identity-box").style.display = "none";
  document.getElementById("unknown-retry-box").style.display = "none";
  document.getElementById("recorded-outcome-box").style.display = "none";
  document.getElementById("kiosk-decision-panel").className = "confirmation-panel";
  setScanStatus("Ready for employee face scan.", "neutral");
}

function setScanStatus(msg, level) {
  const el = document.getElementById("scan-progress-banner");
  if (!el) return;
  el.textContent = msg;
  el.className = "alert alert-" + (level === "neutral" ? "info" : level);
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("kiosk-video")) {
    startCameraPreview();
  }
});

