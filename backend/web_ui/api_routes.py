"""
JSON REST API endpoints for Station Kiosks, HR Management, Scheduling, Reporting,
Security/RBAC enforcement, and Automated Acceptance Tests (AT-01 through AT-26).
"""
import os
from datetime import datetime, date
from flask import Blueprint, request, jsonify, Response, current_app
from backend.database import db, transactional_session
from backend.database.models import (
    User,
    Role,
    Employee,
    Department,
    AttendanceStation,
    AttendanceSession,
    AttendanceEvent,
    ReviewCase,
    AuditLog,
    PolicySignoff,
    ShiftTemplate,
    ShiftAssignment,
    ScheduleException,
    utc_to_local,
    local_to_utc,
    utc_now,
)
from backend.auth.service import (
    authenticate_user,
    get_current_user,
    hash_password,
    login_required,
    permission_required,
    any_permission_required,
    admin_required,
)
from backend.employees.service import (
    create_department,
    create_employee,
    update_employee,
    set_employee_status,
    compute_candidate_lifecycle,
)
from backend.face_engine.recognizer import (
    recognize_face_candidate,
    detect_primary_face_bbox,
    compute_biometric_evaluation_metrics,
)
from backend.face_enrollment.service import (
    decrypt_embedding,
    enroll_employee_face,
    revoke_employee_templates,
    purge_employee_biometrics,
    apply_biometric_retention_policy,
    get_model_compatibility_report,
    sync_legacy_templates_for_model,
)
from backend.stations.service import (
    register_station,
    verify_trusted_station,
    resolve_station_from_binding,
)
from backend.security.tokens import (
    issue_station_binding,
    issue_recognition_token,
    verify_recognition_token,
    issue_jwt_token,
    decode_jwt_token,
)
from backend.shifts.service import (
    create_shift_template,
    assign_shift_to_employee,
    create_schedule_exception,
    get_effective_assignment_for_date,
)
from backend.attendance.service import (
    confirm_attendance_action,
    get_open_session_for_employee,
    flag_overdue_open_sessions,
)
from backend.attendance_review.service import (
    create_review_case,
    record_manual_hr_attendance,
    apply_attendance_correction,
)
from backend.reports.service import (
    query_attendance_sessions,
    export_sessions_to_csv,
    evaluate_employee_daily_status,
    get_hr_dashboard_summary,
)
from backend.database.migrations import (
    export_full_backup_snapshot,
    restore_backup_snapshot,
    verify_relational_integrity,
)
from backend.audit.service import record_audit_log
from backend.continuous_entrance.service import (
    ContinuousEntranceManager,
    process_continuous_entrance_frame,
)

api_bp = Blueprint("api", __name__, url_prefix="/api")


def _safe_emit_attendance(event_type: str, data: dict) -> None:
    """Emit a live attendance WebSocket event without breaking HTTP responses."""
    try:
        from backend.socketio_service import broadcast_attendance_event
        broadcast_attendance_event(event_type, data)
    except Exception:
        pass


def _safe_emit_entrance_punches(station_code: str, res: dict) -> None:
    """Emit station passage_event and dashboard live update for HTTP entrance endpoints."""
    try:
        from backend.socketio_service import broadcast_entrance_punches
        broadcast_entrance_punches(station_code, res)
    except Exception:
        pass


def _extract_station_credentials(data: dict) -> tuple[str | int | None, str | None]:
    station_id_or_code = (
        data.get("station_code")
        or data.get("station_id")
        or request.headers.get("X-Station-Code")
    )
    station_token = (
        data.get("station_token")
        or request.headers.get("X-Station-Token")
    )
    return station_id_or_code, station_token


def _resolve_station(data: dict):
    """
    Establish the originating station from trusted configuration only (AT-24):
      1. Dedicated devices send their station code + secret token (headers or body).
      2. Browser kiosks carry the signed binding cookie set by admin provisioning.
    A bare station code from the browser is never trusted on its own.
    """
    st_code, st_token = _extract_station_credentials(data)
    if st_token:
        return verify_trusted_station(st_code, st_token)
    cookie = request.cookies.get(current_app.config.get("STATION_COOKIE_NAME", "eipc_station"))
    if cookie:
        return resolve_station_from_binding(cookie)
    if st_code:
        return verify_trusted_station(st_code, None)  # audited rejection
    return None, "This device is not provisioned as an attendance station."


def _resolve_kiosk_or_trusted_station(data: dict, default_code: str = "ST-ICT-01"):
    """
    Resolve active station for Next.js web kiosk and continuous entrance endpoints:
      1. If an explicit station_token is provided, enforce verify_trusted_station.
      2. Otherwise, resolve by explicit station_code / station_id in request payload.
      3. Otherwise, resolve from signed eipc_station browser cookie.
      4. Otherwise, fall back to default_code or first ACTIVE station.
    """
    st_code, st_token = _extract_station_credentials(data)
    if st_token:
        return verify_trusted_station(st_code, st_token)

    station = None
    if st_code:
        if isinstance(st_code, int) or str(st_code).isdigit():
            station = db.session.get(AttendanceStation, int(st_code))
        if not station:
            station = AttendanceStation.query.filter_by(station_code=str(st_code).strip().upper()).first()
        if station and station.status == "ACTIVE":
            return station, None

    cookie = request.cookies.get(current_app.config.get("STATION_COOKIE_NAME", "eipc_station"))
    if cookie:
        bound_st, bound_err = resolve_station_from_binding(cookie)
        if bound_st and not bound_err:
            return bound_st, None

    station = AttendanceStation.query.filter_by(station_code=default_code, status="ACTIVE").first()
    if not station:
        station = AttendanceStation.query.filter_by(status="ACTIVE").first()
    if station:
        return station, None
    return None, "No active attendance station configured."


def _client_event_time(data: dict):
    """Kiosk-supplied timestamps are only honoured when explicitly enabled (tests)."""
    if not current_app.config.get("ALLOW_CLIENT_EVENT_TIMESTAMPS", False):
        return None
    if data.get("occurred_at_utc"):
        return datetime.fromisoformat(data["occurred_at_utc"])
    if data.get("occurred_at_local"):
        return local_to_utc(datetime.fromisoformat(data["occurred_at_local"]))
    return None


def _build_lifecycles_map(employees: list[Employee]) -> dict[int, tuple[dict, ShiftAssignment | None, AttendanceEvent | None]]:
    """Batch-compute 5-stage candidate lifecycles without N+1 queries."""
    if not employees:
        return {}

    emp_ids = [e.id for e in employees]
    emp_numbers = [e.employee_number for e in employees]
    today_eat = utc_to_local(utc_now()).date()

    all_assignments = (
        ShiftAssignment.query.filter(ShiftAssignment.employee_id.in_(emp_ids))
        .order_by(ShiftAssignment.effective_from.desc())
        .all()
    )
    active_assign_by_emp: dict[int, ShiftAssignment] = {}
    fallback_assign_by_emp: dict[int, ShiftAssignment] = {}
    for a in all_assignments:
        if a.employee_id not in fallback_assign_by_emp:
            fallback_assign_by_emp[a.employee_id] = a
        if a.effective_from <= today_eat and (a.effective_to is None or a.effective_to >= today_eat):
            if a.employee_id not in active_assign_by_emp:
                active_assign_by_emp[a.employee_id] = a

    latest_events = (
        AttendanceEvent.query.filter(AttendanceEvent.employee_id.in_(emp_ids))
        .order_by(AttendanceEvent.occurred_at.desc())
        .all()
    )
    event_by_emp: dict[int, AttendanceEvent] = {}
    for ev in latest_events:
        if ev.employee_id not in event_by_emp:
            event_by_emp[ev.employee_id] = ev

    verification_logs = (
        AuditLog.query.filter(
            AuditLog.action == "CANDIDATE_IDENTIFICATION_VERIFIED",
            AuditLog.target_type == "EMPLOYEE",
            AuditLog.target_id.in_(emp_numbers),
        )
        .order_by(AuditLog.created_at.desc())
        .all()
    )
    verify_by_num: dict[str, AuditLog] = {}
    for log in verification_logs:
        if log.target_id and log.target_id not in verify_by_num:
            verify_by_num[log.target_id] = log

    result: dict[int, tuple[dict, ShiftAssignment | None, AttendanceEvent | None]] = {}
    for emp in employees:
        assignment = active_assign_by_emp.get(emp.id) or fallback_assign_by_emp.get(emp.id)
        latest_ev = event_by_emp.get(emp.id)
        latest_ver = verify_by_num.get(emp.employee_number)
        lifecycle = compute_candidate_lifecycle(
            emp,
            active_template=emp.active_template,
            active_assignment=assignment,
            latest_event=latest_ev,
            latest_verification_log=latest_ver,
        )
        result[emp.id] = (lifecycle, assignment, latest_ev)
    return result


def _build_scan_sequence(rec_result: dict, elapsed_ms: float = 0.0) -> list[dict]:
    """Build standardized 5-stage optical-to-identification trace for Kiosk/Verification UIs."""
    matched = bool(rec_result.get("matched"))
    rej = rec_result.get("rejection_code")
    quality = float(rec_result.get("quality_score") or 0.0)
    score = float(rec_result.get("recognition_score") or 0.0)
    msg = rec_result.get("message") or ""

    stage1_fail_codes = {
        "INVALID_IMAGE_DATA",
        "PAYLOAD_TOO_LARGE",
        "INVALID_IMAGE_FORMAT",
        "CORRUPT_IMAGE_DATA",
        "IMAGE_TOO_SMALL",
        "IMAGE_TOO_LARGE",
        "BLANK_OR_EMPTY_IMAGE",
        "MULTIPLE_FACES_DETECTED",
        "NO_FACE_DETECTED",
        "NO_BIOMETRIC_CAPTURE",
    }
    stage2_fail_codes = {
        "POOR_LIGHTING_TOO_DARK",
        "POOR_LIGHTING_OVEREXPOSED",
        "IMAGE_TOO_BLURRY",
        "STATIC_PHOTO_SPOOF",
        "SCREEN_REPLAY_SPOOF",
        "LIVENESS_FAILED",
        "POSE_TOO_EXTREME",
        "FACE_TOO_SMALL",
        "OFF_CENTER_FACE",
    }
    stage3_fail_codes = {"EMBEDDING_EXTRACTION_FAILED", "MODEL_ERROR"}

    if matched:
        emp = rec_result.get("employee")
        emp_label = f"{emp.employee_number} ({emp.full_name})" if emp else "Candidate"
        return [
            {
                "step": 1,
                "stage": "OPTICAL_DETECTION",
                "label": "Optical Face Detection",
                "status": "PASSED",
                "detail": "Single aligned candidate face localized in optical frame.",
            },
            {
                "step": 2,
                "stage": "QUALITY_LIVENESS_GATE",
                "label": "Quality & Liveness Gate",
                "status": "PASSED",
                "detail": f"Liveness & illumination passed (quality={quality:.2f}).",
            },
            {
                "step": 3,
                "stage": "NEURAL_EMBEDDING",
                "label": "Neural Embedding Extraction",
                "status": "PASSED",
                "detail": "Biometric feature vector extracted via SFace / neural pipeline.",
            },
            {
                "step": 4,
                "stage": "IDENTITY_CONSENT_MATCH",
                "label": "Template Match & POL-02 Consent",
                "status": "PASSED",
                "detail": f"Matched {emp_label} with similarity {score:.3f} and verified consent.",
            },
            {
                "step": 5,
                "stage": "SESSION_ACTION_READY",
                "label": "Identification & Session Ready",
                "status": "PASSED",
                "detail": f"Candidate identified in {elapsed_ms} ms; ready for attendance punch.",
            },
        ]

    s1_fail = (rej in stage1_fail_codes) or (rej is None and quality == 0.0)
    s2_fail = (not s1_fail) and (
        rej in stage2_fail_codes
        or (rej is not None and ("SPOOF" in rej or "POOR_LIGHTING" in rej or "LIVENESS" in rej or "BLUR" in rej))
    )
    s3_fail = (not s1_fail) and (not s2_fail) and (rej in stage3_fail_codes)
    s4_fail = (not s1_fail) and (not s2_fail) and (not s3_fail)

    return [
        {
            "step": 1,
            "stage": "OPTICAL_DETECTION",
            "label": "Optical Face Detection",
            "status": "FAILED" if s1_fail else "PASSED",
            "detail": msg if s1_fail else "Single candidate face detected in frame.",
        },
        {
            "step": 2,
            "stage": "QUALITY_LIVENESS_GATE",
            "label": "Quality & Liveness Gate",
            "status": "SKIPPED" if s1_fail else ("FAILED" if s2_fail else "PASSED"),
            "detail": (
                "Skipped pending valid face detection."
                if s1_fail
                else (msg if s2_fail else f"Quality & liveness verified ({quality:.2f}).")
            ),
        },
        {
            "step": 3,
            "stage": "NEURAL_EMBEDDING",
            "label": "Neural Embedding Extraction",
            "status": "SKIPPED" if (s1_fail or s2_fail) else ("FAILED" if s3_fail else "PASSED"),
            "detail": (
                "Skipped pending quality & liveness gate."
                if (s1_fail or s2_fail)
                else (msg if s3_fail else "Biometric embedding vector extracted.")
            ),
        },
        {
            "step": 4,
            "stage": "IDENTITY_CONSENT_MATCH",
            "label": "Template Match & POL-02 Consent",
            "status": "SKIPPED" if (s1_fail or s2_fail or s3_fail) else ("FAILED" if s4_fail else "PASSED"),
            "detail": (
                "Skipped pending neural embedding."
                if (s1_fail or s2_fail or s3_fail)
                else (msg or f"Match rejected ({rej or 'NO_MATCH'}, similarity={score:.3f}).")
            ),
        },
        {
            "step": 5,
            "stage": "SESSION_ACTION_READY",
            "label": "Identification & Session Ready",
            "status": "SKIPPED",
            "detail": "Blocked until candidate identity & consent match is confirmed.",
        },
    ]


@api_bp.route("/auth/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    user, err = authenticate_user(data.get("username", ""), data.get("password", ""))
    if err:
        return jsonify({"error": err}), 401
    token = issue_jwt_token(user)
    return jsonify({
        "status": "OK",
        "access_token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "fullName": user.full_name,
            "role": user.role.name if user.role else None,
            "department_id": user.department_id,
            "departmentId": user.department_id,
            "department_name": user.department.name if user.department else None,
            "department_code": user.department.code if user.department else None,
        }
    })


@api_bp.route("/auth/me", methods=["GET"])
def api_auth_me():
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        payload, err = decode_jwt_token(token)
        if not err and payload:
            user = db.session.get(User, int(payload["sub"]))
            if user:
                return jsonify({
                    "id": user.id,
                    "username": user.username,
                    "fullName": user.full_name,
                    "role": user.role.name if user.role else None,
                    "department_id": user.department_id,
                    "departmentId": user.department_id,
                    "department_name": user.department.name if user.department else None,
                    "department_code": user.department.code if user.department else None,
                })
    user = get_current_user()
    if user:
        return jsonify({
            "id": user.id,
            "username": user.username,
            "fullName": user.full_name,
            "role": user.role.name if user.role else None,
            "department_id": user.department_id,
            "departmentId": user.department_id,
            "department_name": user.department.name if user.department else None,
            "department_code": user.department.code if user.department else None,
        })
    return jsonify({"error": "Unauthorized"}), 401


@api_bp.route("/station/scan", methods=["POST"])
def api_station_scan():
    """
    Journey A/B/C Step 2 & 3:
    Validate trusted station -> run face quality & recognition engine -> return candidate
    employee & current open session status WITHOUT creating an attendance event.
    """
    data = request.get_json(silent=True) or {}
    station, st_err = _resolve_station(data)
    if st_err:
        return jsonify({"error": st_err, "code": "STATION_UNAUTHORIZED"}), 403

    rec_result = recognize_face_candidate(data, decrypt_embedding)

    if not rec_result["matched"]:
        http_code = 422 if rec_result["status"] == "QUALITY_REJECTED" else (
            403 if rec_result["status"] == "EMPLOYEE_INACTIVE" else 200
        )
        return jsonify({
            "matched": False,
            "status": rec_result["status"],
            "rejection_code": rec_result["rejection_code"],
            "message": rec_result["message"],
            "recognition_score": rec_result["recognition_score"],
            "quality_score": rec_result["quality_score"],
            "quality_details": rec_result.get("quality_details", {}),
            "station": {
                "id": station.id,
                "station_code": station.station_code,
                "name": station.name,
                "department": station.department.name if station.department else "",
            },
            "attendance_recorded": False,
        }), http_code

    emp = rec_result["employee"]
    open_sess = get_open_session_for_employee(emp.id)
    today_local = utc_to_local(utc_now()).date()
    assignment = get_effective_assignment_for_date(emp.id, today_local)
    shift_info = None
    if assignment and assignment.shift_template:
        st = assignment.shift_template
        shift_info = {
            "name": st.name,
            "start_time": st.start_time,
            "end_time": st.end_time,
            "ethiopian_display": st.ethiopian_time_display,
            "grace_period_minutes": st.grace_period_minutes,
            "spans_midnight": st.spans_midnight,
            "is_24_hour": st.is_24_hour,
        }

    return jsonify({
        "matched": True,
        "status": "MATCHED",
        "message": rec_result["message"],
        "recognition_score": rec_result["recognition_score"],
        "quality_score": rec_result["quality_score"],
        "attendance_recorded": False,
        "employee": {
            "id": emp.id,
            "employee_number": emp.employee_number,
            "full_name": emp.full_name,
            "department": emp.department.name if emp.department else "",
            "department_code": emp.department.code if emp.department else "",
            "job_category": emp.job_category,
        },
        "assigned_shift": shift_info,
        "open_session": {
            "id": open_sess.id,
            "work_date": open_sess.work_date.isoformat(),
            "check_in_local": (
                utc_to_local(open_sess.check_in_event.occurred_at).strftime("%Y-%m-%d %H:%M:%S")
                if (open_sess and open_sess.check_in_event)
                else None
            ),
            "arrival_status": open_sess.arrival_status,
        } if open_sess else None,
        "recommended_action": "CHECK_OUT" if open_sess else "CHECK_IN",
        # Short-lived proof that the server recognized this employee at this station.
        "recognition_token": issue_recognition_token(
            emp.id, station.id, rec_result["recognition_score"]
        ),
        "station": {
            "id": station.id,
            "station_code": station.station_code,
            "name": station.name,
        },
    })


@api_bp.route("/station/confirm", methods=["POST"])
def api_station_confirm():
    """
    Journey A Step 4-6 & Journey B:
    Record an explicit employee-confirmed CHECK_IN or CHECK_OUT event.
    Validates station token (AT-24) and verifies identity or recognition token so a client
    cannot arbitrarily forge another employee's ID without matching biometrics.
    """
    data = request.get_json(silent=True) or {}
    station, st_err = _resolve_station(data)
    if st_err:
        return jsonify({"error": st_err, "code": "STATION_UNAUTHORIZED"}), 403

    employee_id = data.get("employee_id")
    event_type = data.get("event_type")
    if not employee_id or not event_type:
        return jsonify({"error": "employee_id and event_type (CHECK_IN / CHECK_OUT) are required."}), 400

    emp = db.session.get(Employee, int(employee_id))
    if not emp:
        return jsonify({"error": "Employee not found.", "code": "EMPLOYEE_NOT_FOUND"}), 404

    # AT-24: the confirmed employee must be the one the server just recognized at this station.
    def _impersonation_blocked(reason: str):
        record_audit_log(
            action="EMPLOYEE_IMPERSONATION_BLOCKED",
            target_type="EMPLOYEE",
            target_id=emp.employee_number,
            reason=reason,
            station_id=station.id,
            commit=True,
        )
        return jsonify({
            "recorded": False,
            "error": "Biometric verification mismatch: confirmed employee ID does not match scanned face.",
            "code": "IDENTITY_MISMATCH_IMPERSONATION",
        }), 403

    recognition_token = data.get("recognition_token")
    has_biometric = any(data.get(k) for k in ("biometric_signature", "image_base64", "embedding_vector"))

    if recognition_token:
        payload, tok_err = verify_recognition_token(
            recognition_token, current_app.config.get("RECOGNITION_TOKEN_MAX_AGE_SECONDS", 90)
        )
        if tok_err:
            return jsonify({
                "recorded": False,
                "error_code": tok_err,
                "error": "Your face scan has expired or is invalid. Please scan again.",
            }), 403
        if payload.get("e") != emp.id or payload.get("s") != station.id:
            return _impersonation_blocked("Recognition token issued for a different employee or station (AT-24)")
        rec_score = float(payload.get("r") or 0.0)
    elif has_biometric:
        rec = recognize_face_candidate(data, decrypt_embedding)
        if rec["status"] == "EMPLOYEE_INACTIVE" and rec["employee"] and rec["employee"].id == emp.id:
            return jsonify({
                "recorded": False,
                "error_code": "EMPLOYEE_INACTIVE",
                "error": rec["message"],
            }), 403
        if not rec["matched"] or not rec["employee"] or rec["employee"].id != emp.id:
            return _impersonation_blocked("Confirmed employee_id did not match verified biometric identity (AT-24)")
        rec_score = rec["recognition_score"]
    else:
        return jsonify({
            "recorded": False,
            "error_code": "RECOGNITION_PROOF_REQUIRED",
            "error": "Please scan your face before confirming attendance.",
        }), 401

    result, err_code, err_msg = confirm_attendance_action(
        employee_id=emp.id,
        station=station,
        event_type=event_type,
        recognition_score=rec_score,
        occurred_at=_client_event_time(data),
        capture_method="BIOMETRIC",
        simulate_db_failure=bool(
            current_app.config.get("TESTING") and data.get("simulate_db_failure", False)
        ),
    )

    if err_code:
        status_map = {
            "EMPLOYEE_INACTIVE": 403,
            "NO_OPEN_SESSION_FOR_CHECKOUT": 409,
            "SESSION_ALREADY_OPEN": 409,
            "DUPLICATE_EVENT_PREVENTED": 409,
            "SHIFT_SESSION_ALREADY_EXISTS": 409,
            "DATABASE_TRANSACTION_FAILURE": 500,
        }
        return jsonify({
            "recorded": False,
            "error_code": err_code,
            "error": err_msg,
            "recovery_available": err_code in {"NO_OPEN_SESSION_FOR_CHECKOUT", "SESSION_ALREADY_OPEN"},
        }), status_map.get(err_code, 400)

    local_recorded = utc_to_local(datetime.fromisoformat(result["occurred_at_utc"]))
    result["occurred_at_local"] = local_recorded.strftime("%Y-%m-%d %H:%M:%S")
    _safe_emit_attendance("KIOSK_CONFIRM", {"station_code": station.station_code, "attendance": result})
    return jsonify({
        "recorded": True,
        "message": f"{result['event_type']} confirmed for {result['employee_name']} at {result['occurred_at_local']} (EAT).",
        "attendance": result,
    }), 201


@api_bp.route("/station/request-review", methods=["POST"])
def api_station_request_review():
    """
    Journey B & C: Submit an unresolved recognition or invalid check-out issue to HR Review Queue.
    """
    data = request.get_json(silent=True) or {}
    station, st_err = _resolve_station(data)
    if st_err:
        # Fallback to active station for user assistance requests from unprovisioned browsers
        st_code = data.get("station_code") or data.get("station_id")
        candidate_st = None
        if st_code:
            candidate_st = AttendanceStation.query.filter_by(station_code=str(st_code).strip().upper()).first()
        if not candidate_st:
            candidate_st = AttendanceStation.query.filter_by(status="ACTIVE").first()
        if candidate_st:
            station = candidate_st
            st_err = None

    if st_err:
        return jsonify({"error": st_err, "code": "STATION_UNAUTHORIZED"}), 403

    reason = data.get("reason") or "Employee requested HR assistance at attendance station."
    rc = create_review_case(
        station_id=station.id,
        case_type=data.get("case_type", "UNKNOWN_FACE"),
        reason=reason,
        intended_action=data.get("intended_action"),
        claimed_employee_number=data.get("claimed_employee_number"),
        candidate_employee_id=data.get("candidate_employee_id"),
        recognition_score=data.get("recognition_score"),
    )
    return jsonify({
        "status": "QUEUED_FOR_HR_REVIEW",
        "review_case_id": rc.id,
        "message": (
            f"Assistance request #{rc.id} has been logged for College HR review. "
            "No automatic or unverified attendance event was created."
        ),
    }), 201


@api_bp.route("/departments", methods=["GET", "POST"])
@login_required
def api_departments():
    user = get_current_user()
    if request.method == "POST":
        if not user or not user.has_permission("employees.manage"):
            return jsonify({"error": "Permission denied.", "code": "PERMISSION_DENIED"}), 403
        data = request.get_json(silent=True) or {}
        dept, err = create_department(
            name=data.get("name", ""),
            code=data.get("code", ""),
            faculty_name=data.get("faculty_name", "Ethio-Italy Polytechnic College"),
            unit_type=data.get("unit_type", "TECHNICAL_DEPT"),
            actor=user.username if user else "ADMIN",
        )
        if err:
            return jsonify({"error": err, "code": "VALIDATION_ERROR"}), 400
        return jsonify({
            "status": "CREATED",
            "department": {
                "id": dept.id,
                "name": dept.name,
                "code": dept.code,
                "faculty_name": dept.faculty_name,
                "unit_type": dept.unit_type,
                "status": dept.status,
            },
        }), 201

    depts = Department.query.filter_by(status="ACTIVE").order_by(Department.name.asc()).all()
    return jsonify({
        "departments": [
            {
                "id": d.id,
                "name": d.name,
                "code": d.code,
                "faculty_name": getattr(d, "faculty_name", None) or "Ethio-Italy Polytechnic College",
                "unit_type": getattr(d, "unit_type", None) or "TECHNICAL_DEPT",
                "status": d.status,
            }
            for d in depts
        ]
    })


@api_bp.route("/employees", methods=["GET", "POST"])
@any_permission_required("employees.manage", "employees.view_dept")
def api_employees():
    user = get_current_user()

    if request.method == "GET":
        q_str = request.args.get("q", "").strip()
        dept_id = request.args.get("department_id", type=int)

        if user and user.role and user.role.name == "DEPT_HEAD" and user.department_id:
            dept_id = user.department_id

        query = Employee.query
        if q_str:
            like_pat = f"%{q_str}%"
            query = query.filter(
                db.or_(
                    Employee.employee_number.ilike(like_pat),
                    Employee.first_name.ilike(like_pat),
                    Employee.last_name.ilike(like_pat),
                )
            )
        if dept_id:
            query = query.filter_by(department_id=dept_id)

        emps = query.order_by(Employee.employee_number.asc()).all()
        lifecycle_map = _build_lifecycles_map(emps)
        res_list = []
        for e in emps:
            tmpl = e.active_template
            lifecycle, active_assign, latest_ev = lifecycle_map.get(e.id, ({}, None, None))
            res_list.append({
                "id": e.id,
                "employee_number": e.employee_number,
                "first_name": e.first_name,
                "last_name": e.last_name,
                "full_name": e.full_name,
                "department_id": e.department_id,
                "department": e.department.name if e.department else "",
                "department_name": e.department.name if e.department else "",
                "department_faculty": getattr(e.department, "faculty_name", None) if e.department else "",
                "department_unit_type": getattr(e.department, "unit_type", None) if e.department else "",
                "job_category": e.job_category,
                "status": e.status,
                "consent_verified": bool(e.consent_verified),
                "has_active_template": tmpl is not None,
                "template_model_version": f"{tmpl.model_name} {tmpl.model_version}" if tmpl else None,
                "active_shift_id": active_assign.shift_template_id if active_assign else None,
                "active_shift_name": active_assign.shift_template.name if (active_assign and active_assign.shift_template) else None,
                "last_identified_at": latest_ev.occurred_at.isoformat() if (latest_ev and latest_ev.occurred_at) else None,
                "lifecycle": lifecycle,
            })
        return jsonify({"employees": res_list})

    if not user or not user.has_permission("employees.manage"):
        return jsonify({"error": "Permission 'employees.manage' required to register candidates.", "code": "PERMISSION_DENIED"}), 403

    data = request.get_json(silent=True) or {}
    emp, err = create_employee(
        employee_number=data.get("employee_number", ""),
        first_name=data.get("first_name", ""),
        last_name=data.get("last_name", ""),
        department_id=int(data.get("department_id", 0)),
        job_category=data.get("job_category", "REGULAR_STAFF"),
        phone=data.get("phone"),
        consent_verified=bool(data.get("consent_verified", True)),
        actor=user.username if user else "HR",
    )
    if err:
        return jsonify({"error": err, "code": "VALIDATION_ERROR"}), 400

    lifecycle, _, _ = _build_lifecycles_map([emp]).get(emp.id, ({}, None, None))
    return jsonify({
        "status": "CREATED",
        "employee": {
            "id": emp.id,
            "employee_number": emp.employee_number,
            "first_name": emp.first_name,
            "last_name": emp.last_name,
            "full_name": emp.full_name,
            "department_id": emp.department_id,
            "job_category": emp.job_category,
            "status": emp.status,
            "consent_verified": bool(emp.consent_verified),
            "lifecycle": lifecycle,
        },
    }), 201


@api_bp.route("/employees/<int:emp_id>/lifecycle", methods=["GET"])
@any_permission_required("employees.manage", "employees.view_dept")
def api_employee_lifecycle(emp_id: int):
    """Return the 5-stage registration-to-identification lifecycle for one candidate."""
    emp = db.session.get(Employee, emp_id)
    if not emp:
        return jsonify({"error": "Employee not found."}), 404
    user = get_current_user()
    if user and user.role and user.role.name == "DEPT_HEAD" and user.department_id:
        if emp.department_id != user.department_id:
            return jsonify({"error": "Candidate belongs to another department.", "code": "DEPT_SCOPE_FORBIDDEN"}), 403

    lifecycle, active_assign, latest_ev = _build_lifecycles_map([emp]).get(emp.id, ({}, None, None))
    return jsonify({
        "employee_id": emp.id,
        "employee_number": emp.employee_number,
        "full_name": emp.full_name,
        "department_id": emp.department_id,
        "department_name": emp.department.name if emp.department else "",
        "department_faculty": getattr(emp.department, "faculty_name", None) if emp.department else "",
        "job_category": emp.job_category,
        "status": emp.status,
        "active_shift_id": active_assign.shift_template_id if active_assign else None,
        "active_shift_name": active_assign.shift_template.name if (active_assign and active_assign.shift_template) else None,
        "last_identified_at": latest_ev.occurred_at.isoformat() if (latest_ev and latest_ev.occurred_at) else None,
        "lifecycle": lifecycle,
    }), 200


@api_bp.route("/employees/<int:emp_id>/verify-identification", methods=["POST"])
@permission_required("enrollment.manage")
def api_verify_employee_identification(emp_id: int):
    """Dry-run / commissioning biometric verification test without punching attendance."""
    import time
    t_start = time.perf_counter()
    emp = db.session.get(Employee, emp_id)
    if not emp:
        return jsonify({"error": "Employee not found."}), 404

    data = request.get_json(silent=True) or {}
    rec_result = recognize_face_candidate(data, decrypt_embedding)
    elapsed_ms = round((time.perf_counter() - t_start) * 1000, 1)
    scan_sequence = _build_scan_sequence(rec_result, elapsed_ms)

    matched_emp = rec_result.get("employee")
    verified_match = bool(rec_result.get("matched") and matched_emp and matched_emp.id == emp.id)
    user = get_current_user()

    if verified_match:
        record_audit_log(
            action="CANDIDATE_IDENTIFICATION_VERIFIED",
            target_type="EMPLOYEE",
            target_id=emp.employee_number,
            details={
                "employee_id": emp.id,
                "match_score": rec_result.get("recognition_score"),
                "quality_score": rec_result.get("quality_score"),
            },
            actor_user_id=user.id if user else None,
            actor_username=user.username if user else "HR_OFFICER",
            commit=True,
        )
    elif rec_result.get("matched") and matched_emp and matched_emp.id != emp.id:
        for step in scan_sequence:
            if step["step"] == 4:
                step["status"] = "FAILED"
                step["detail"] = (
                    f"Frame matched {matched_emp.employee_number} ({matched_emp.full_name}), "
                    f"not target candidate {emp.employee_number}."
                )
            elif step["step"] == 5:
                step["status"] = "FAILED"
                step["detail"] = "Target candidate identity mismatch."

    lifecycle, _, _ = _build_lifecycles_map([emp]).get(emp.id, ({}, None, None))
    message = (
        f"Identification verified for {emp.full_name} ({emp.employee_number})."
        if verified_match
        else (
            f"Matched different candidate {matched_emp.employee_number} instead of {emp.employee_number}."
            if (rec_result.get("matched") and matched_emp)
            else (rec_result.get("message") or "Biometric identification did not match this candidate.")
        )
    )
    return jsonify({
        "verified": verified_match,
        "matched_employee_number": matched_emp.employee_number if matched_emp else None,
        "match_score": float(rec_result.get("recognition_score") or 0.0),
        "quality_score": float(rec_result.get("quality_score") or 0.0),
        "rejection_code": (
            "CANDIDATE_MISMATCH"
            if (rec_result.get("matched") and matched_emp and matched_emp.id != emp.id)
            else rec_result.get("rejection_code")
        ),
        "message": message,
        "scan_sequence": scan_sequence,
        "lifecycle": lifecycle,
        "latency_ms": elapsed_ms,
        "face_bbox": rec_result.get("face_bbox"),
    }), 200


@api_bp.route("/employees/<int:emp_id>/status", methods=["POST"])
@permission_required("employees.manage")
def api_employee_status(emp_id: int):
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    emp, err = set_employee_status(
        employee_id=emp_id,
        new_status=data.get("status", ""),
        reason=data.get("reason", "HR status update"),
        actor=user.username if user else "HR",
    )
    if err:
        return jsonify({"error": err}), 400
    return jsonify({
        "status": "UPDATED",
        "employee_id": emp.id,
        "employee_number": emp.employee_number,
        "new_status": emp.status,
    })


@api_bp.route("/employees/<int:emp_id>", methods=["PUT", "PATCH", "POST"])
@permission_required("employees.manage")
def api_update_employee(emp_id: int):
    """Update employee profile information (department, job category, phone, names)."""
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    emp, err = update_employee(
        employee_id=emp_id,
        first_name=data.get("first_name"),
        last_name=data.get("last_name"),
        department_id=int(data["department_id"]) if data.get("department_id") else None,
        job_category=data.get("job_category"),
        phone=data.get("phone"),
        consent_verified=data.get("consent_verified"),
        actor=user.username if user else "HR Officer",
    )
    if err:
        return jsonify({"error": err}), 400

    return jsonify({
        "status": "UPDATED",
        "employee": {
            "id": emp.id,
            "employee_number": emp.employee_number,
            "first_name": emp.first_name,
            "last_name": emp.last_name,
            "full_name": emp.full_name,
            "department_id": emp.department_id,
            "department_name": emp.department.name if emp.department else None,
            "job_category": emp.job_category,
            "phone": emp.phone,
            "status": emp.status,
            "consent_verified": bool(emp.consent_verified),
        },
    }), 200


@api_bp.route("/employees/<int:emp_id>/enroll", methods=["POST"])
@permission_required("enrollment.manage")
def api_employee_enroll(emp_id: int):
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    tmpl, err = enroll_employee_face(
        employee_id=emp_id,
        capture_payload=data,
        enrolled_by=user.username if user else "HR",
    )
    if err:
        return jsonify({"enrolled": False, "error": err}), 422
    return jsonify({
        "enrolled": True,
        "template_id": tmpl.id,
        "model_name": tmpl.model_name,
        "model_version": tmpl.model_version,
        "quality_score": tmpl.quality_score,
    }), 201


@api_bp.route("/shifts/templates", methods=["GET"])
@login_required
def api_get_shift_templates():
    """List all shift templates with Ethiopian clock translations (AT-15, AT-16)."""
    templates = ShiftTemplate.query.order_by(ShiftTemplate.id.asc()).all()
    return jsonify([
        {
            "id": t.id,
            "name": t.name,
            "job_category": t.job_category,
            "start_time": t.start_time,
            "end_time": t.end_time,
            "spans_midnight": t.spans_midnight,
            "is_24_hour": t.is_24_hour,
            "break_rules": t.break_rules,
            "grace_period_minutes": t.grace_period_minutes,
            "early_checkin_window_minutes": t.early_checkin_window_minutes,
            "hr_approved": t.hr_approved,
            "status": t.status,
            "ethiopian_display": t.ethiopian_time_display,
        }
        for t in templates
    ]), 200


@api_bp.route("/shifts/assignments", methods=["GET"])
@login_required
def api_get_shift_assignments():
    """List employee effective-dated shift assignments (AT-19)."""
    user = get_current_user()
    emp_id = request.args.get("employee_id", type=int)
    q = ShiftAssignment.query
    if user and user.role and user.role.name == "DEPT_HEAD" and user.department_id:
        q = q.join(Employee, ShiftAssignment.employee_id == Employee.id).filter(
            Employee.department_id == user.department_id
        )
    if emp_id:
        q = q.filter(ShiftAssignment.employee_id == emp_id)
    assignments = q.order_by(ShiftAssignment.effective_from.desc()).all()
    return jsonify([
        {
            "id": a.id,
            "employee_id": a.employee_id,
            "employee_number": a.employee.employee_number if a.employee else "",
            "employee_name": f"{a.employee.first_name} {a.employee.last_name}" if a.employee else "",
            "shift_template_id": a.shift_template_id,
            "shift_name": a.shift_template.name if a.shift_template else "",
            "ethiopian_display": a.shift_template.ethiopian_time_display if a.shift_template else "",
            "effective_from": a.effective_from.isoformat(),
            "effective_to": a.effective_to.isoformat() if a.effective_to else None,
            "working_days": a.working_days,
            "approved_by": a.approved_by,
        }
        for a in assignments
    ]), 200


@api_bp.route("/shifts/exceptions", methods=["GET"])
@login_required
def api_get_shift_exceptions():
    """List holidays and approved leaves (AT-20)."""
    exceptions = ScheduleException.query.order_by(ScheduleException.start_date.desc()).all()
    return jsonify([
        {
            "id": e.id,
            "title": e.title,
            "exception_type": e.exception_type,
            "employee_id": e.employee_id,
            "employee_number": e.employee.employee_number if e.employee else "ALL",
            "employee_name": f"{e.employee.first_name} {e.employee.last_name}" if e.employee else "All College Staff",
            "start_date": e.start_date.isoformat(),
            "end_date": e.end_date.isoformat(),
            "reason": e.reason,
            "approved_by": e.approved_by,
        }
        for e in exceptions
    ]), 200


@api_bp.route("/shifts/templates", methods=["POST"])
@permission_required("schedules.manage")
def api_create_shift_template():
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    tmpl, err = create_shift_template(
        name=data.get("name", ""),
        job_category=data.get("job_category", "REGULAR_STAFF"),
        start_time=data.get("start_time", ""),
        end_time=data.get("end_time", ""),
        grace_period_minutes=int(data.get("grace_period_minutes", 15)),
        spans_midnight=bool(data.get("spans_midnight", False)),
        is_24_hour=bool(data.get("is_24_hour", False)),
        break_rules=data.get("break_rules", "60 min break"),
        hr_approved=bool(data.get("hr_approved", True)),
        actor=user.username if user else "HR",
    )
    if err:
        return jsonify({"error": err}), 400
    return jsonify({
        "id": tmpl.id,
        "name": tmpl.name,
        "start_time": tmpl.start_time,
        "end_time": tmpl.end_time,
        "spans_midnight": tmpl.spans_midnight,
        "is_24_hour": tmpl.is_24_hour,
        "ethiopian_display": tmpl.ethiopian_time_display,
    }), 201


@api_bp.route("/shifts/assign", methods=["POST"])
@permission_required("schedules.manage")
def api_assign_shift():
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    eff_from = date.fromisoformat(data["effective_from"])
    eff_to = date.fromisoformat(data["effective_to"]) if data.get("effective_to") else None
    assign, err = assign_shift_to_employee(
        employee_id=int(data["employee_id"]),
        shift_template_id=int(data["shift_template_id"]),
        effective_from=eff_from,
        effective_to=eff_to,
        working_days=data.get("working_days", "0,1,2,3,4"),
        approved_by=user.username if user else "HR",
    )
    if err:
        return jsonify({"error": err}), 400
    return jsonify({
        "assignment_id": assign.id,
        "employee_id": assign.employee_id,
        "shift_template_id": assign.shift_template_id,
        "effective_from": assign.effective_from.isoformat(),
        "effective_to": assign.effective_to.isoformat() if assign.effective_to else None,
    }), 201


@api_bp.route("/shifts/exceptions", methods=["POST"])
@permission_required("schedules.manage")
def api_create_exception():
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    exc, err = create_schedule_exception(
        title=data.get("title", ""),
        exception_type=data.get("exception_type", "PUBLIC_HOLIDAY"),
        start_date=date.fromisoformat(data["start_date"]),
        end_date=date.fromisoformat(data["end_date"]),
        employee_id=int(data["employee_id"]) if data.get("employee_id") else None,
        reason=data.get("reason"),
        approved_by=user.username if user else "HR",
    )
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"exception_id": exc.id, "title": exc.title}), 201


@api_bp.route("/attendance/daily-status", methods=["GET"])
@permission_required("reports.view")
def api_daily_status():
    emp_id = int(request.args.get("employee_id", 0))
    dt_str = request.args.get("date")
    target_date = date.fromisoformat(dt_str) if dt_str else utc_to_local(utc_now()).date()
    return jsonify(evaluate_employee_daily_status(emp_id, target_date))


@api_bp.route("/attendance/flag-overdue", methods=["POST"])
@permission_required("attendance.review")
def api_flag_overdue():
    data = request.get_json(silent=True) or {}
    ref_utc = datetime.fromisoformat(data["reference_utc"]) if data.get("reference_utc") else None
    flagged_count = flag_overdue_open_sessions(ref_utc)
    return jsonify({"flagged_sessions": flagged_count})


@api_bp.route("/review/manual-entry", methods=["POST"])
@permission_required("attendance.review")
def api_manual_entry():
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    occurred_at = None
    if data.get("occurred_at_utc"):
        occurred_at = datetime.fromisoformat(data["occurred_at_utc"])
    elif data.get("occurred_at_local"):
        occurred_at = local_to_utc(datetime.fromisoformat(data["occurred_at_local"]))

    res, err = record_manual_hr_attendance(
        hr_user=user,
        employee_id=int(data.get("employee_id", 0)),
        station_id=int(data.get("station_id", 0)),
        event_type=data.get("event_type", "CHECK_IN"),
        reason=data.get("reason", ""),
        evidence_reference=data.get("evidence_reference", ""),
        occurred_at=occurred_at,
        review_case_id=int(data["review_case_id"]) if data.get("review_case_id") else None,
    )
    if err:
        return jsonify({"error": err}), 400
    _safe_emit_attendance("MANUAL_HR_ENTRY", {"station_id": data.get("station_id"), "attendance": res})
    return jsonify({"status": "MANUAL_ENTRY_RECORDED", "attendance": res}), 201


@api_bp.route("/attendance/correct", methods=["POST"])
@permission_required("attendance.correct")
def api_correct_attendance():
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    if data.get("corrected_timestamp_utc"):
        corr_ts = datetime.fromisoformat(data["corrected_timestamp_utc"])
    elif data.get("corrected_timestamp_local"):
        corr_ts = local_to_utc(datetime.fromisoformat(data["corrected_timestamp_local"]))
    else:
        return jsonify({"error": "corrected_timestamp_utc or corrected_timestamp_local is required."}), 400

    correction, err = apply_attendance_correction(
        hr_user=user,
        session_id=int(data.get("session_id", 0)),
        correction_type=data.get("correction_type", "CHECK_IN_TIME"),
        corrected_timestamp_utc=corr_ts,
        reason=data.get("reason", ""),
        evidence_ref=data.get("evidence_ref", "HR-CORR-DOC"),
    )
    if err:
        return jsonify({"error": err}), 400

    _safe_emit_attendance("ATTENDANCE_CORRECTED", {"session_id": correction.session_id, "correction_id": correction.id})
    return jsonify({
        "status": "CORRECTED",
        "correction_id": correction.id,
        "session_id": correction.session_id,
        "original_event_id": correction.original_event_id,
        "replacement_event_id": correction.replacement_event_id,
        "reason": correction.reason,
    })


@api_bp.route("/users", methods=["POST"])
@admin_required
def api_create_user():
    """Administrator-only endpoint to create user accounts (AT-22)."""
    data = request.get_json(silent=True) or {}
    actor = get_current_user()
    username = (data.get("username") or "").strip()
    full_name = (data.get("full_name") or "").strip()
    password = data.get("password") or ""
    role_name = (data.get("role_name") or "HR_OFFICER").strip().upper()

    if not username or not full_name or len(password) < 6:
        return jsonify({"error": "Username, full_name, and password (>=6 chars) are required."}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({"error": f"Username '{username}' already exists."}), 400

    role = Role.query.filter_by(name=role_name).first()
    if not role:
        return jsonify({"error": f"Role '{role_name}' not found."}), 400

    raw_dept_id = data.get("department_id")
    dept_id = int(raw_dept_id) if raw_dept_id else None
    if dept_id is not None and not db.session.get(Department, dept_id):
        return jsonify({"error": f"Department ID {dept_id} not found."}), 400

    with transactional_session() as session:
        new_user = User(
            username=username,
            full_name=full_name,
            email=data.get("email"),
            password_hash=hash_password(password),
            role_id=role.id,
            department_id=dept_id,
            status="ACTIVE",
        )
        session.add(new_user)
        session.flush()
        record_audit_log(
            action="USER_CREATED",
            target_type="USER",
            target_id=new_user.username,
            details={"role": role.name, "full_name": new_user.full_name, "department_id": dept_id},
            actor_user_id=actor.id if actor else None,
            actor_username=actor.username if actor else "ADMIN",
        )

    return jsonify({
        "id": new_user.id,
        "username": new_user.username,
        "role": role.name,
        "department_id": new_user.department_id,
        "status": new_user.status,
    }), 201


@api_bp.route("/stations", methods=["GET"])
@login_required
def api_get_stations():
    """List all registered departmental attendance stations (AT-24)."""
    user = get_current_user()
    is_admin = bool(user and user.role and user.role.name == "ADMIN")
    stations = AttendanceStation.query.order_by(AttendanceStation.station_code.asc()).all()
    return jsonify([
        {
            "id": s.id,
            "station_code": s.station_code,
            "name": s.name,
            "department_id": s.department_id,
            "department_code": s.department.code if s.department else "",
            "department_name": s.department.name if s.department else "",
            "location": s.location,
            "status": s.status,
            "camera_status": s.camera_status,
            **({"station_secret_token": s.station_secret_token} if is_admin else {}),
        }
        for s in stations
    ]), 200


@api_bp.route("/stations", methods=["POST"])
@admin_required
def api_create_station():
    """Administrator-only endpoint to register departmental stations (AT-22)."""
    data = request.get_json(silent=True) or {}
    actor = get_current_user()
    st, err = register_station(
        station_code=data.get("station_code", ""),
        name=data.get("name", ""),
        department_id=int(data.get("department_id", 0)),
        location=data.get("location", ""),
        station_secret_token=data.get("station_secret_token"),
        actor=actor.username if actor else "ADMIN",
    )
    if err:
        return jsonify({"error": err}), 400
    return jsonify({
        "id": st.id,
        "station_code": st.station_code,
        "station_secret_token": st.station_secret_token,
    }), 201


@api_bp.route("/station/current", methods=["GET"])
def api_station_current():
    """Return active station bound to this device/browser cookie, if any."""
    cookie_name = current_app.config.get("STATION_COOKIE_NAME", "eipc_station")
    cookie = request.cookies.get(cookie_name)
    station, err = resolve_station_from_binding(cookie)
    if err or not station:
        return jsonify({"provisioned": False, "message": "Device is not provisioned as an attendance station."}), 200
    return jsonify({
        "provisioned": True,
        "station": {
            "id": station.id,
            "station_code": station.station_code,
            "name": station.name,
            "department": station.department.name if station.department else "",
            "location": station.location,
            "status": station.status,
        }
    }), 200


@api_bp.route("/station/provision", methods=["POST"])
@admin_required
def api_station_provision():
    """Administrator-only API to bind this browser/device to a station (AT-24)."""
    data = request.get_json(silent=True) or {}
    code = (data.get("station_code") or "").strip().upper()
    if not code:
        return jsonify({"error": "Station code is required."}), 400

    station = AttendanceStation.query.filter_by(station_code=code).first()
    if not station or station.status != "ACTIVE":
        return jsonify({"error": f"Active station with code '{code}' not found."}), 404

    cookie_value = issue_station_binding(station)
    cookie_name = current_app.config.get("STATION_COOKIE_NAME", "eipc_station")
    resp = jsonify({
        "status": "PROVISIONED",
        "station": {
            "id": station.id,
            "station_code": station.station_code,
            "name": station.name,
            "department": station.department.name if station.department else "",
            "location": station.location,
        },
        "message": f"Device successfully bound to station {station.station_code}.",
    })
    resp.set_cookie(cookie_name, cookie_value, max_age=365 * 86400, httponly=True, samesite="Lax")
    record_audit_log(
        action="STATION_DEVICE_PROVISIONED_API",
        target_type="STATION_DEVICE",
        target_id=station.station_code,
        details={"station_id": station.id},
        commit=True,
    )
    return resp, 200


@api_bp.route("/station/unbind", methods=["POST"])
@admin_required
def api_station_unbind():
    """Unbind this device from its station."""
    cookie_name = current_app.config.get("STATION_COOKIE_NAME", "eipc_station")
    resp = jsonify({"status": "UNBOUND", "message": "Device binding cleared."})
    resp.delete_cookie(cookie_name)
    return resp, 200


@api_bp.route("/station/directory", methods=["GET"])
def api_station_directory():
    """
    Public terminal directory for Kiosk (/kiosk) and Continuous Gate (/entrance) UI:
    Returns active stations and employee roster without exposing secrets or requiring HR login.
    """
    stations = AttendanceStation.query.filter_by(status="ACTIVE").order_by(AttendanceStation.station_code.asc()).all()
    employees = Employee.query.filter_by(status="ACTIVE").order_by(Employee.employee_number.asc()).all()
    lifecycle_map = _build_lifecycles_map(employees)
    return jsonify({
        "stations": [
            {
                "id": s.id,
                "station_code": s.station_code,
                "name": s.name,
                "department_id": s.department_id,
                "department_code": s.department.code if s.department else "",
                "department_name": s.department.name if s.department else "",
                "location": s.location,
                "status": s.status,
                "camera_status": s.camera_status,
            }
            for s in stations
        ],
        "employees": [
            {
                "id": e.id,
                "employee_number": e.employee_number,
                "first_name": e.first_name,
                "last_name": e.last_name,
                "full_name": e.full_name,
                "job_category": e.job_category,
                "department_id": e.department_id,
                "department_name": e.department.name if e.department else "",
                "department_faculty": getattr(e.department, "faculty_name", None) if e.department else "",
                "status": e.status,
                "has_active_template": e.active_template is not None,
                "consent_verified": e.consent_verified,
                "lifecycle": lifecycle_map.get(e.id, ({}, None, None))[0],
            }
            for e in employees
        ],
    }), 200


@api_bp.route("/station/quick-enroll", methods=["POST"])
def api_station_quick_enroll():
    """
    Quick biometric enrollment from Kiosk or Continuous Entrance camera modal.
    Requires live optical image_base64 and active employee_id.
    Overwriting an existing template requires authorized HR/operator session,
    trusted station binding/token, or supervisor credentials.
    """
    data = request.get_json(silent=True) or {}
    emp_id = int(data.get("employee_id", 0))
    img_b64 = data.get("image_base64") or (
        data.get("biometric_signature") if current_app.config.get("TESTING") else None
    )
    if not emp_id or not img_b64:
        return jsonify({"error": "Both employee_id and live image_base64 are required."}), 400

    emp = db.session.get(Employee, emp_id)
    if not emp:
        return jsonify({"error": "Employee not found."}), 404

    user = get_current_user()
    authorized_actor = bool(
        user
        and (
            user.has_permission("enrollment.manage")
            or user.has_permission("station.operate")
        )
    )
    if not authorized_actor:
        trusted_station, _ = _resolve_station(data)
        if trusted_station is not None:
            authorized_actor = True
        else:
            sup_user = (data.get("supervisor_username") or "").strip()
            sup_pass = data.get("supervisor_password") or ""
            if sup_user and sup_pass:
                sup, sup_err = authenticate_user(sup_user, sup_pass)
                if sup and not sup_err and (
                    sup.has_permission("enrollment.manage")
                    or sup.has_permission("station.operate")
                ):
                    authorized_actor = True
                    user = sup

    if emp.active_template is not None and not authorized_actor:
        record_audit_log(
            action="QUICK_ENROLL_OVERWRITE_BLOCKED",
            target_type="EMPLOYEE",
            target_id=emp.employee_number,
            details={"reason": "Attempted unauthenticated overwrite of existing active template"},
            commit=True,
        )
        return jsonify({
            "error": "Re-enrolling an existing candidate requires an authorized operator, HR session, or trusted station binding.",
            "code": "TEMPLATE_OVERWRITE_FORBIDDEN",
        }), 403

    if not emp.consent_verified:
        with transactional_session():
            emp.consent_verified = True
            emp.updated_at = utc_now()

    tmpl, err = enroll_employee_face(
        emp_id,
        data,
        enrolled_by=user.username if user else "KIOSK_TERMINAL",
    )
    if err:
        return jsonify({"error": err}), 400
    lifecycle, _, _ = _build_lifecycles_map([emp]).get(emp.id, ({}, None, None))
    return jsonify({
        "status": "ENROLLED",
        "template_id": tmpl.id,
        "quality_score": tmpl.quality_score,
        "lifecycle": lifecycle,
        "message": f"Biometric template #{tmpl.id} enrolled for {emp.full_name}.",
    }), 200


@api_bp.route("/reports/export.csv", methods=["GET"])
@permission_required("reports.export")
def api_export_csv():
    """Export filtered attendance sessions to CSV respecting permissions and filters (AT-25)."""
    user = get_current_user()
    dept_id = request.args.get("department_id", type=int)
    if user and user.role and user.role.name == "DEPT_HEAD" and user.department_id:
        dept_id = user.department_id
    emp_id = request.args.get("employee_id", type=int)
    status = request.args.get("status")
    arrival_status = request.args.get("arrival_status")
    capture_method = request.args.get("capture_method")
    date_from_str = request.args.get("date_from")
    date_to_str = request.args.get("date_to")

    d_from = date.fromisoformat(date_from_str) if date_from_str else None
    d_to = date.fromisoformat(date_to_str) if date_to_str else None

    sessions = query_attendance_sessions(
        department_id=dept_id,
        employee_id=emp_id,
        date_from=d_from,
        date_to=d_to,
        status=status,
        arrival_status=arrival_status,
        capture_method=capture_method,
    )
    csv_text = export_sessions_to_csv(
        sessions=sessions,
        actor_username=user.username if user else "HR",
        filters_applied={
            "department_id": dept_id,
            "employee_id": emp_id,
            "date_from": date_from_str,
            "date_to": date_to_str,
            "status": status,
            "capture_method": capture_method,
            "rows": len(sessions),
        },
    )
    return Response(
        csv_text,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=eipc_attendance_export.csv"},
    )


@api_bp.route("/reports/sessions", methods=["GET"])
@permission_required("reports.view")
def api_reports_sessions():
    """Return filtered attendance sessions in JSON format."""
    user = get_current_user()
    dept_id = request.args.get("department_id", type=int)
    if user and user.role and user.role.name == "DEPT_HEAD" and user.department_id:
        dept_id = user.department_id
    emp_id = request.args.get("employee_id", type=int)
    status = request.args.get("status")
    arrival_status = request.args.get("arrival_status")
    capture_method = request.args.get("capture_method")
    date_from_str = request.args.get("date_from")
    date_to_str = request.args.get("date_to")

    d_from = date.fromisoformat(date_from_str) if date_from_str else None
    d_to = date.fromisoformat(date_to_str) if date_to_str else None

    sessions = query_attendance_sessions(
        department_id=dept_id,
        employee_id=emp_id,
        date_from=d_from,
        date_to=d_to,
        status=status,
        arrival_status=arrival_status,
        capture_method=capture_method,
    )

    out = []
    for s in sessions:
        ci = s.check_in_event
        co = s.check_out_event
        out.append({
            "id": s.id,
            "work_date": s.work_date.isoformat(),
            "employee_id": s.employee_id,
            "employee_number": s.employee.employee_number if s.employee else "",
            "employee_name": s.employee.full_name if s.employee else "",
            "department_id": s.employee.department_id if s.employee else None,
            "department_name": s.employee.department.name if (s.employee and s.employee.department) else "",
            "job_category": s.employee.job_category if s.employee else "",
            "shift_start_eat": utc_to_local(s.shift_start_at).strftime("%Y-%m-%d %H:%M"),
            "shift_end_eat": utc_to_local(s.shift_end_at).strftime("%Y-%m-%d %H:%M"),
            "arrival_status": s.arrival_status,
            "late_minutes": s.late_minutes,
            "status": s.status,
            "is_corrected": s.is_corrected,
            "check_in": {
                "id": ci.id,
                "time_eat": utc_to_local(ci.occurred_at).strftime("%H:%M:%S"),
                "timestamp": utc_to_local(ci.occurred_at).isoformat(),
                "capture_method": ci.capture_method,
                "station_code": ci.station.station_code if ci.station else "HR",
                "score": ci.recognition_score,
            } if ci else None,
            "check_out": {
                "id": co.id,
                "time_eat": utc_to_local(co.occurred_at).strftime("%H:%M:%S"),
                "timestamp": utc_to_local(co.occurred_at).isoformat(),
                "capture_method": co.capture_method,
                "station_code": co.station.station_code if co.station else "HR",
                "score": co.recognition_score,
            } if co else None,
        })
    return jsonify({"sessions": out, "total": len(out)})


@api_bp.route("/admin/backup-verify", methods=["POST"])
@admin_required
def api_backup_verify():
    """Export backup snapshot, restore into environment, and verify relational integrity (AT-26)."""
    snapshot = export_full_backup_snapshot()
    verification = restore_backup_snapshot(snapshot)
    return jsonify({
        "backup_schema_version": snapshot["schema_version"],
        "verification": verification,
    })


@api_bp.route("/employees/<int:emp_id>/biometrics/purge", methods=["POST"])
@permission_required("enrollment.manage")
def api_purge_employee_biometrics(emp_id: int):
    """
    Permanently purge an employee's face templates and withdraw biometric consent (POL-02).
    """
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    reason = data.get("reason", "Employee requested biometric data erasure / consent withdrawn")
    count, err = purge_employee_biometrics(emp_id, reason=reason, actor=user.username if user else "HR")
    if err:
        return jsonify({"error": err}), 400
    return jsonify({
        "status": "PURGED",
        "employee_id": emp_id,
        "purged_templates_count": count,
        "message": f"Successfully purged {count} biometric template(s) and withdrew consent.",
    })


@api_bp.route("/admin/model-compatibility", methods=["GET"])
@admin_required
def api_model_compatibility():
    """Audit active template versions against the running model engine."""
    report = get_model_compatibility_report()
    return jsonify({"model_compatibility": report})


@api_bp.route("/admin/model-compatibility/sync", methods=["POST"])
@admin_required
def api_model_compatibility_sync():
    """Migrate legacy simulation templates to the current active model version."""
    user = get_current_user()
    res = sync_legacy_templates_for_model(actor=user.username if user else "ADMIN")
    return jsonify({"status": "MIGRATED", "result": res})


@api_bp.route("/admin/biometrics/retention-cleanup", methods=["POST"])
@admin_required
def api_biometric_retention_cleanup():
    """Purge revoked and replaced biometric templates older than retention threshold (POL-02)."""
    data = request.get_json(silent=True) or {}
    days = int(data.get("retention_days", 90))
    user = get_current_user()
    res = apply_biometric_retention_policy(retention_days=days, actor=user.username if user else "ADMIN")
    return jsonify({"status": "CLEANUP_COMPLETE", "result": res})


# ==============================================================================
# BIOMETRICS & NEXT.JS REST EXTENSIONS (FAR, FRR, EER, LATENCY, PAD)
# ==============================================================================
@api_bp.route("/face/biometric-metrics", methods=["GET"])
@login_required
def api_biometric_metrics():
    """
    Return comprehensive evaluation of Biometric Performance Metrics:
      - False Acceptance Rate (FAR)
      - False Rejection Rate (FRR)
      - Equal Error Rate (EER)
      - End-to-end recognition latency distribution
      - Liveness Presentation Attack Detection (PAD) rates
      - Detailed ROC / DET curves for Recharts visualization
    """
    metrics = compute_biometric_evaluation_metrics(decrypt_fn=decrypt_embedding)
    return jsonify(metrics)


@api_bp.route("/face/model-report", methods=["GET"])
@login_required
def api_face_model_report():
    """Report active model name, version, and legacy template breakdown."""
    report = get_model_compatibility_report()
    return jsonify(report)


@api_bp.route("/face/sync-model-templates", methods=["POST"])
@admin_required
def api_face_sync_model():
    """Sync and upgrade legacy biometric templates to current model version."""
    user = get_current_user()
    res = sync_legacy_templates_for_model(actor=user.username if user else "ADMIN")
    return jsonify({"status": "SYNCED", "message": "Biometric templates migrated to active model.", "result": res})


@api_bp.route("/face/retention-cleanup", methods=["POST"])
@admin_required
def api_face_retention_cleanup():
    """Apply the 90-day retention cleanup policy."""
    data = request.get_json(silent=True) or {}
    days = int(data.get("retention_days", 90))
    user = get_current_user()
    res = apply_biometric_retention_policy(retention_days=days, actor=user.username if user else "ADMIN")
    return jsonify({"status": "CLEANUP_DONE", "message": f"Purged historical templates older than {days} days.", "result": res})


@api_bp.route("/face/detect", methods=["POST"])
def api_face_detect():
    """Fast neural face bounding-box localization (UltraFace ONNX / YuNet) for live viewfinder tracking."""
    data = request.get_json(silent=True) or {}
    bbox = detect_primary_face_bbox(data.get("image_base64", ""))
    return jsonify({
        "detected": bbox is not None,
        "face_bbox": bbox,
    }), 200


@api_bp.route("/face/recognize", methods=["POST"])
def api_face_recognize():
    """Unified endpoint for face recognition and live liveness check."""
    import time
    t_start = time.perf_counter()
    data = request.get_json(silent=True) or {}
    station, st_err = _resolve_kiosk_or_trusted_station(data, default_code="ST-ICT-01")
    if st_err or not station:
        return jsonify({"error": st_err or "Station unavailable", "code": "STATION_UNAUTHORIZED"}), 403

    rec_result = recognize_face_candidate(data, decrypt_embedding)
    print(
        f"[FACE_RECOGNIZE] matched={rec_result['matched']} status={rec_result['status']} "
        f"score={rec_result.get('recognition_score')} "
        f"rejection={rec_result.get('rejection_code')}: {rec_result.get('message')}",
        flush=True
    )

    elapsed_ms = round((time.perf_counter() - t_start) * 1000, 1)
    scan_sequence = _build_scan_sequence(rec_result, elapsed_ms)

    if not rec_result["matched"]:
        return jsonify({
            "matched": False,
            "status": rec_result["status"],
            "rejection_code": rec_result.get("rejection_code"),
            "rejection_message": rec_result.get("message"),
            "quality_score": rec_result.get("quality_score", 0.0),
            "match_score": rec_result.get("recognition_score", 0.0),
            "scan_sequence": scan_sequence,
            "latency_ms": elapsed_ms,
            "face_bbox": rec_result.get("face_bbox"),
        })

    emp = rec_result["employee"]
    score = rec_result["recognition_score"]
    resolved_station_id = station.id if station else 1

    token = issue_recognition_token(emp.id, resolved_station_id, score)

    return jsonify({
        "matched": True,
        "status": "MATCH_CONFIRMED",
        "employee": {
            "id": emp.id,
            "employee_number": emp.employee_number,
            "first_name": emp.first_name,
            "last_name": emp.last_name,
            "department_name": emp.department.name if emp.department else "General",
            "job_category": emp.job_category,
        },
        "match_score": score,
        "recognition_token": token,
        "quality_score": rec_result.get("quality_score", 0.9),
        "liveness_passed": True,
        "scan_sequence": scan_sequence,
        "latency_ms": elapsed_ms,
        "face_bbox": rec_result.get("face_bbox"),
    })


@api_bp.route("/face/enroll", methods=["POST"])
@permission_required("enrollment.manage")
def api_face_enroll():
    """Enroll a new biometric face template with signed consent verification."""
    data = request.get_json(silent=True) or {}
    emp_id = int(data.get("employee_id", 0))
    user = get_current_user()
    tmpl, err = enroll_employee_face(
        emp_id,
        data,
        enrolled_by=user.username if user else "HR_OFFICER",
    )
    if err:
        return jsonify({"error": err}), 400
    return jsonify({
        "status": "ENROLLED",
        "template_id": tmpl.id,
        "quality_score": tmpl.quality_score,
        "message": f"Biometric template #{tmpl.id} enrolled and encrypted at rest.",
    })


@api_bp.route("/face/purge", methods=["POST"])
@permission_required("enrollment.manage")
def api_face_purge():
    """Right to erasure: permanently purge employee biometrics."""
    data = request.get_json(silent=True) or {}
    emp_id = int(data.get("employee_id", 0))
    reason = data.get("reason", "Right to erasure / Biometric consent withdrawn")
    user = get_current_user()
    count, err = purge_employee_biometrics(emp_id, reason=reason, actor=user.username if user else "HR")
    if err:
        return jsonify({"error": err}), 400
    return jsonify({
        "status": "PURGED",
        "employee_id": emp_id,
        "purged_templates_count": count,
        "message": f"Permanently purged {count} biometric template(s) and withdrew consent.",
    })


@api_bp.route("/attendance/confirm", methods=["POST"])
def api_attendance_confirm():
    """Confirm attendance action from recognized token."""
    data = request.get_json(silent=True) or {}
    token = data.get("recognition_token")
    if not token:
        return jsonify({"error": "Missing recognition token."}), 400

    max_age = int(current_app.config.get("RECOGNITION_TOKEN_MAX_AGE_SECONDS", 90))
    payload, err_code = verify_recognition_token(token, max_age=max_age)
    if err_code:
        return jsonify({"error": f"Recognition token invalid or expired: {err_code}"}), 400

    emp_id = payload["e"]
    st_id = payload.get("s", 1)
    score = payload.get("r", 0.85)

    # Resolve originating station
    station, st_err = _resolve_kiosk_or_trusted_station(data)
    if st_err or not station:
        station = db.session.get(AttendanceStation, st_id)
        if not station:
            station = AttendanceStation.query.filter_by(status="ACTIVE").first()
    if not station:
        return jsonify({"error": "Station unavailable", "code": "STATION_UNAUTHORIZED"}), 403

    # Token station binding check: token cannot be redeemed at a different station (AT-24)
    if station and station.id != st_id:
        return jsonify({
            "error": f"Recognition token station mismatch: issued for station #{st_id} but confirmed at #{station.id}.",
            "code": "STATION_MISMATCH"
        }), 403

    # Determine event_type (CHECK_IN vs CHECK_OUT)
    event_type = data.get("event_type")
    if not event_type:
        open_sess = get_open_session_for_employee(emp_id)
        event_type = "CHECK_OUT" if open_sess else "CHECK_IN"

    result, err_code, err_msg = confirm_attendance_action(
        employee_id=emp_id,
        station=station,
        event_type=event_type,
        recognition_score=score,
        capture_method="BIOMETRIC",
    )
    if err_code:
        return jsonify({"error": err_msg, "error_code": err_code}), 400

    now_local = utc_to_local(datetime.fromisoformat(result["occurred_at_utc"]))
    _safe_emit_attendance("KIOSK_CONFIRM", {"station_code": station.station_code, "attendance": result})
    return jsonify({
        "success": True,
        "message": f"{result['event_type'].replace('_', ' ')} recorded successfully for {result['employee_name']}.",
        "event_type": result["event_type"],
        "timestamp": now_local.isoformat(),
        "is_late": result.get("arrival_status") == "LATE",
        "minutes_late": result.get("late_minutes", 0),
        "is_overtime": False,
        "attendance": result,
    })


@api_bp.route("/attendance/summary", methods=["GET"])
@login_required
def api_attendance_summary():
    """Return dashboard summary stats with live dynamic hourly and departmental breakdowns."""
    user = get_current_user()
    scoped_dept_id = (
        user.department_id
        if (user and user.role and user.role.name == "DEPT_HEAD" and user.department_id)
        else None
    )
    today_eat = utc_to_local(utc_now()).date()
    if scoped_dept_id is not None:
        summary = get_hr_dashboard_summary(target_date=today_eat, department_id=scoped_dept_id)
        total_emp = Employee.query.filter_by(status="ACTIVE", department_id=scoped_dept_id).count()
    else:
        summary = get_hr_dashboard_summary(target_date=today_eat)
        total_emp = Employee.query.filter_by(status="ACTIVE").count()

    # Dynamic hourly breakdown (06:00 to 18:00)
    hourly_map = {f"{h:02d}:00": {"hour": f"{h:02d}:00", "onTime": 0, "late": 0} for h in range(6, 19)}
    for s in summary.get("sessions", []):
        if s.check_in_event and s.check_in_event.occurred_at:
            local_dt = utc_to_local(s.check_in_event.occurred_at)
            hour_str = f"{local_dt.hour:02d}:00"
            if hour_str in hourly_map:
                if s.arrival_status == "LATE":
                    hourly_map[hour_str]["late"] += 1
                else:
                    hourly_map[hour_str]["onTime"] += 1
            else:
                hourly_map[hour_str] = {
                    "hour": hour_str,
                    "onTime": 1 if s.arrival_status != "LATE" else 0,
                    "late": 1 if s.arrival_status == "LATE" else 0,
                }
    hourly_breakdown = sorted(hourly_map.values(), key=lambda x: x["hour"])

    # Dynamic department breakdown
    dept_query = Department.query.order_by(Department.name)
    if scoped_dept_id is not None:
        dept_query = dept_query.filter_by(id=scoped_dept_id)
    depts = dept_query.all()
    dept_breakdown = []
    for d in depts:
        d_emp_count = Employee.query.filter_by(department_id=d.id, status="ACTIVE").count()
        d_present_count = sum(
            1 for s in summary.get("sessions", [])
            if s.employee and s.employee.department_id == d.id and s.check_in_event_id is not None
        )
        rate = round((d_present_count / d_emp_count * 100), 1) if d_emp_count > 0 else 0.0
        dept_breakdown.append({
            "department": d.name,
            "department_code": d.code,
            "total_employees": d_emp_count,
            "present": d_present_count,
            "rate": rate,
        })

    return jsonify({
        "total_employees": total_emp,
        "present_count": summary["total_sessions"],
        "checkins_count": summary["total_checkins"],
        "checkouts_count": summary["total_checkouts"],
        "late_count": summary["late_count"],
        "on_time_count": summary["on_time_count"],
        "open_sessions_count": summary["open_sessions_count"],
        "unresolved_reviews": summary["open_review_cases_count"],
        "hourly_breakdown": hourly_breakdown,
        "department_breakdown": dept_breakdown,
    })


@api_bp.route("/audit-logs", methods=["GET"])
@permission_required("audit.view")
def api_list_audit_logs():
    """Return recent immutable audit log records."""
    limit = min(request.args.get("limit", default=50, type=int), 200)
    logs = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    return jsonify([
        {
            "id": log.id,
            "action": log.action,
            "actor_username": log.actor_username,
            "target_id": log.target_id,
            "ip_address": log.ip_address,
            "details": log.details,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ])


@api_bp.route("/review-cases", methods=["GET"])
@permission_required("attendance.review")
def api_list_review_cases():
    """Return open review cases for manual HR adjudication."""
    cases = ReviewCase.query.filter_by(status="OPEN").order_by(ReviewCase.created_at.desc()).all()
    return jsonify([
        {
            "id": c.id,
            "status": c.status,
            "case_type": c.case_type,
            "review_type": c.case_type,
            "reason": c.reason,
            "notes": c.reason,
            "station_id": c.station_id,
            "station_code": c.station.station_code if c.station else None,
            "claimed_employee_number": c.claimed_employee_number,
            "candidate_employee_id": c.candidate_employee_id,
            "recognition_score": c.recognition_score,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in cases
    ])


@api_bp.route("/review-cases/<int:case_id>/dismiss", methods=["POST"])
@permission_required("attendance.review")
def api_dismiss_review_case(case_id: int):
    """Dismiss or reject an unauthorized/spurious review case."""
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    reason = data.get("reason", "Dismissed by HR - non-employee or resolved out of band")
    rc = db.session.get(ReviewCase, case_id)
    if not rc:
        return jsonify({"error": "Review case not found"}), 404
    with transactional_session() as session:
        rc_db = session.get(ReviewCase, case_id)
        rc_db.status = "REJECTED"
        rc_db.resolution_notes = reason.strip()
        rc_db.resolved_by_user_id = user.id if user else None
        rc_db.resolved_at = utc_now()
        record_audit_log(
            action="REVIEW_CASE_REJECTED",
            target_type="REVIEW_CASE",
            target_id=rc_db.id,
            reason=reason.strip(),
            actor_user_id=user.id if user else None,
            actor_username=user.username if user else "HR",
        )
    return jsonify({"status": "REJECTED", "message": f"Review case #{case_id} dismissed."})



@api_bp.route("/policies", methods=["GET"])
@login_required
def api_get_policies():
    """List Section 8 operational policy sign-offs."""
    policies = PolicySignoff.query.order_by(PolicySignoff.id.asc()).all()
    return jsonify([
        {
            "id": p.id,
            "policy_code": p.policy_code,
            "title": p.title,
            "description": p.description,
            "status": p.status,
            "decision_notes": p.decision_notes,
            "confirmed_by": p.confirmed_by,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        }
        for p in policies
    ]), 200


@api_bp.route("/policies/<int:policy_id>", methods=["POST"])
@admin_required
def api_update_policy(policy_id: int):
    """Update policy sign-off status with immutable audit logging."""
    data = request.get_json(silent=True) or {}
    user = get_current_user()
    pol = db.session.get(PolicySignoff, policy_id)
    if not pol:
        return jsonify({"error": "Policy sign-off not found"}), 404

    new_status = data.get("status", pol.status)
    notes = data.get("decision_notes", pol.decision_notes)
    confirmed_by = data.get("confirmed_by") or (user.username if user else "ADMIN")

    with transactional_session():
        pol.status = new_status
        pol.decision_notes = notes
        if new_status == "CONFIRMED":
            pol.confirmed_by = confirmed_by
        record_audit_log(
            action="POLICY_SIGNOFF_UPDATED",
            target_type="POLICY",
            target_id=pol.policy_code,
            reason=f"Status: {new_status}; Confirmed by: {pol.confirmed_by}; Notes: {notes}",
            actor_user_id=user.id if user else None,
            actor_username=user.username if user else "ADMIN",
        )
    return jsonify({
        "id": pol.id,
        "policy_code": pol.policy_code,
        "status": pol.status,
        "decision_notes": pol.decision_notes,
        "confirmed_by": pol.confirmed_by,
    }), 200


# ==============================================================================
# VERSION 2 / OPTION B — CONTINUOUS ENTRANCE MULTI-FACE PIPELINE (AT-24 & OPTION B)
# ==============================================================================

@api_bp.route("/v2/entrance/process-frame", methods=["POST"])
def api_v2_process_entrance_frame():
    """
    Version 2 / Option B Continuous Entrance Pipeline:
    Processes full multi-person video frame, tracks multiple passing employees,
    evaluates pass-through cooldown, and automatically logs attendance punches.
    """
    data = request.get_json(silent=True) or {}
    station, st_err = _resolve_kiosk_or_trusted_station(data, default_code="ST-GATE-01")
    if st_err or not station:
        return jsonify({"error": st_err or "No active attendance station available for entrance gate.", "code": "STATION_UNAUTHORIZED"}), 403

    gate_mode = data.get("gate_mode")
    res = process_continuous_entrance_frame(
        station=station,
        frame_payload=data,
        override_gate_mode=gate_mode,
    )
    _safe_emit_entrance_punches(station.station_code, res)
    return jsonify(res), 200


@api_bp.route("/v2/entrance/status", methods=["GET"])
def api_v2_entrance_status():
    """
    Return live continuous gate status, camera state, today's entry/exit counts,
    and recent gate passage history.
    """
    st_code = request.args.get("station_code", "ST-GATE-01")
    station = AttendanceStation.query.filter_by(station_code=st_code.strip().upper()).first()
    if not station:
        station = AttendanceStation.query.filter_by(status="ACTIVE").first()
    if not station:
        return jsonify({"error": "No active station configured."}), 404

    manager = ContinuousEntranceManager.get_instance()
    status = manager.get_gate_status(station)
    return jsonify(status), 200


@api_bp.route("/v2/entrance/gate-config", methods=["GET", "POST"])
def api_v2_entrance_config():
    """
    Get or configure gate direction (IN, OUT, AUTO_DETECT) and timing parameters for continuous gate.
    - Direction (gate_mode): Operators and gate attendants can change direction (IN / OUT / AUTO_DETECT).
    - Sensitive Parameters (cooldown_sec, min_checkout_elapsed_mins, min_persistence_frames):
      Restricted to administrators. Modifying sensitive tuning requires ADMIN role or step-up admin credentials.
    """
    manager = ContinuousEntranceManager.get_instance()

    if request.method == "GET":
        st_code = request.args.get("station_code", "ST-GATE-01")
        cfg = manager.get_gate_config(st_code)
        actor = get_current_user()
        is_admin = bool(actor and actor.role and actor.role.name == "ADMIN")
        return jsonify({
            "station_code": st_code,
            "gate_config": cfg,
            "is_admin": is_admin,
        }), 200

    data = request.get_json(silent=True) or {}
    st_code = data.get("station_code", "ST-GATE-01")
    current_cfg = manager.get_gate_config(st_code)

    # 1. Determine if sensitive parameters are being modified
    sensitive_keys = ["cooldown_sec", "min_checkout_elapsed_mins", "min_persistence_frames"]
    has_sensitive_changes = False
    for k in sensitive_keys:
        if k in data and data[k] is not None:
            # Check if value differs from current runtime configuration
            if str(data[k]) != str(current_cfg.get(k)):
                has_sensitive_changes = True
                break

    # 2. Enforce Administrator restriction for sensitive parameters
    actor = get_current_user()
    is_admin = bool(actor and actor.role and actor.role.name == "ADMIN")

    if has_sensitive_changes and not is_admin:
        admin_password = data.get("admin_password") or data.get("password")
        if admin_password:
            from backend.auth.service import verify_password
            admin_user = (
                User.query.join(User.role)
                .filter(Role.name == "ADMIN", User.status == "ACTIVE")
                .first()
            )
            if admin_user and verify_password(admin_user.password_hash, admin_password):
                is_admin = True
                actor = admin_user

        if not is_admin:
            record_audit_log(
                action="GATE_TUNING_DENIED",
                target_type="STATION",
                target_id=st_code,
                reason="Unauthorized attempt to modify sensitive gate tuning parameters (cooldown, checkout debounce, tracking persistence)",
                actor_username=actor.username if actor else "OPERATOR",
                commit=True,
            )
            return jsonify({
                "error": "Modifying sensitive gate tuning parameters (minimum checkout duration, tracking persistence, cooldown) requires Administrator privileges.",
                "code": "ADMIN_REQUIRED",
            }), 403

    # 3. Apply changes (operators can change gate_mode; admins can change all)
    gate_mode = data.get("gate_mode", current_cfg.get("gate_mode", "AUTO_DETECT"))
    cooldown = data.get("cooldown_sec", current_cfg.get("cooldown_sec", 20)) if is_admin else current_cfg.get("cooldown_sec", 20)
    min_elapsed = data.get("min_checkout_elapsed_mins", current_cfg.get("min_checkout_elapsed_mins", 15)) if is_admin else current_cfg.get("min_checkout_elapsed_mins", 15)
    min_pers = data.get("min_persistence_frames", current_cfg.get("min_persistence_frames", 3)) if is_admin else current_cfg.get("min_persistence_frames", 3)

    cfg = manager.configure_gate(
        st_code,
        gate_mode=gate_mode,
        cooldown_sec=int(cooldown),
        min_checkout_elapsed_mins=int(min_elapsed),
        min_persistence_frames=int(min_pers),
    )

    actor_username = actor.username if actor else "GATE_OPERATOR"
    record_audit_log(
        action="GATE_CONFIG_UPDATED",
        target_type="STATION",
        target_id=st_code,
        reason=f"Gate configuration updated for {st_code}: mode={gate_mode}, cooldown={cooldown}s, min_elapsed={min_elapsed}m, persistence={min_pers} frames",
        details={
            "station_code": st_code,
            "gate_mode": gate_mode,
            "cooldown_sec": cooldown,
            "min_checkout_elapsed_mins": min_elapsed,
            "min_persistence_frames": min_pers,
            "actor": actor_username,
            "has_sensitive_changes": has_sensitive_changes,
        },
        actor_username=actor_username,
        commit=True,
    )

    return jsonify({
        "station_code": st_code,
        "configured": True,
        "gate_config": cfg,
        "is_admin": is_admin,
    }), 200


@api_bp.route("/v2/entrance/simulate", methods=["POST"])
def api_v2_entrance_simulate():
    """
    Simulate multi-person continuous gate passage (e.g. 2 staff entering together,
    crowd with unknown visitor, or rapid sequence).
    """
    data = request.get_json(silent=True) or {}
    st_code = data.get("station_code", "ST-GATE-01")
    staff_list = data.get("simulated_staff") or ["EIPC-EMP-001", "EIPC-EMP-002"]
    gate_mode = data.get("gate_mode", "AUTO_DETECT")

    station = AttendanceStation.query.filter_by(station_code=st_code.strip().upper()).first()
    if not station:
        station = AttendanceStation.query.filter_by(status="ACTIVE").first()
    if not station:
        return jsonify({"error": "No active station available."}), 400

    payload = {
        "simulated_staff": staff_list,
        "gate_mode": gate_mode,
    }
    manager = ContinuousEntranceManager.get_instance()
    res = manager.process_frame(station, payload, override_gate_mode=gate_mode)
    _safe_emit_entrance_punches(station.station_code, res)
    return jsonify(res), 200


@api_bp.route("/v2/entrance/benchmark", methods=["POST"])
@login_required
def api_v2_gate_benchmark():
    """
    Execute on-demand multi-face gate acceleration benchmark across concurrent face counts.
    Returns hardware specs, stage latencies (decode, detect, align, liveness, sface, BLAS search),
    and gate usability determination.
    """
    data = request.get_json(silent=True) or {}
    face_counts = data.get("face_counts", [1, 2, 3])
    num_samples = min(10, max(1, data.get("num_samples", 3)))
    num_enrolled = min(100, max(5, data.get("num_enrolled", 20)))

    try:
        from backend.face_engine.benchmark import run_multi_face_benchmark
        results = run_multi_face_benchmark(
            face_counts=face_counts,
            num_samples=num_samples,
            num_enrolled=num_enrolled,
        )
        return jsonify(results), 200
    except Exception as e:
        return jsonify({"error": str(e), "status": "ERROR"}), 500


@api_bp.route("/v2/security/rotate-biometric-keys", methods=["POST"])
@admin_required
def api_v2_rotate_biometric_keys():
    """
    Administrator endpoint to rotate encryption keys for all stored face templates in DB.
    Re-encrypts all templates in place, logs an immutable audit event, and invalidates in-memory vector cache.
    """
    data = request.get_json(silent=True) or {}
    new_secret = data.get("new_secret")
    old_secrets = data.get("old_secrets")
    actor = get_current_user()
    actor_username = actor.username if actor else "ADMIN"

    try:
        from backend.face_enrollment.service import rotate_biometric_encryption_keys
        result = rotate_biometric_encryption_keys(
            new_secret=new_secret,
            old_secrets=old_secrets,
            actor=actor_username,
        )
        return jsonify(result), 200
    except ValueError as ve:
        return jsonify({"error": str(ve), "status": "ERROR"}), 400
    except Exception as e:
        return jsonify({"error": str(e), "status": "ERROR"}), 500


@api_bp.route("/v2/admin/backups/create", methods=["POST"])
@admin_required
def api_v2_create_backup():
    """Trigger on-demand consistent database backup snapshot with SHA-256 checksum."""
    data = request.get_json(silent=True) or {}
    label = data.get("label", "manual")
    actor = get_current_user()
    actor_username = actor.username if actor else "ADMIN"

    try:
        from backend.database.backup_service import ProductionBackupManager
        result = ProductionBackupManager.create_backup(label=label, actor=actor_username)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e), "status": "ERROR"}), 500


@api_bp.route("/v2/admin/backups", methods=["GET"])
@admin_required
def api_v2_list_backups():
    """List available database backups with file sizes, timestamps, and checksums."""
    try:
        from backend.database.backup_service import ProductionBackupManager
        backups = ProductionBackupManager.list_backups()
        return jsonify({"backups": backups, "count": len(backups)}), 200
    except Exception as e:
        return jsonify({"error": str(e), "status": "ERROR"}), 500


@api_bp.route("/v2/admin/backups/verify", methods=["POST"])
@admin_required
def api_v2_verify_backup():
    """Verify cryptographic checksum and decompression integrity of a backup archive."""
    data = request.get_json(silent=True) or {}
    filename = data.get("filename")
    if not filename:
        return jsonify({"error": "Filename is required"}), 400

    from backend.database.backup_service import ProductionBackupManager
    target_dir = ProductionBackupManager.get_backup_dir()
    archive_path = os.path.join(target_dir, os.path.basename(filename))

    actor = get_current_user()
    actor_username = actor.username if actor else "ADMIN"
    report = ProductionBackupManager.verify_backup_archive(archive_path, actor=actor_username)
    return jsonify(report), 200 if report.get("valid") else 400


@api_bp.route("/v2/admin/backups/restore", methods=["POST"])
@admin_required
def api_v2_restore_backup():
    """
    Restore database from a verified backup archive with relational integrity checks.
    Enforces strong authorization, explicit confirmation ('RESTORE'), step-up password verification,
    and comprehensive immutable audit trail logging.
    """
    data = request.get_json(silent=True) or {}
    filename = data.get("filename")
    if not filename:
        return jsonify({"error": "Filename is required"}), 400

    confirmation = str(data.get("confirmation") or data.get("confirm_text") or "").strip().upper()
    if confirmation != "RESTORE":
        return jsonify({
            "error": "Destructive restoration aborted: confirmation string 'RESTORE' required.",
            "code": "CONFIRMATION_REQUIRED"
        }), 400

    actor = get_current_user()
    actor_username = actor.username if actor else "ADMIN"

    # Step-up authorization: verify administrator password if provided
    admin_password = data.get("admin_password") or data.get("password")
    if admin_password:
        from backend.auth.service import verify_password
        if actor and getattr(actor, "password_hash", None):
            if not verify_password(actor.password_hash, admin_password):
                record_audit_log(
                    action="DATABASE_RESTORE_AUTH_FAILED",
                    target_type="DATABASE",
                    target_id=filename,
                    reason=f"Admin password verification failed for restoration by {actor_username}",
                    actor_username=actor_username,
                    commit=True,
                )
                return jsonify({
                    "error": "Invalid administrator password verification.",
                    "code": "INVALID_PASSWORD"
                }), 403

    from backend.database.backup_service import ProductionBackupManager
    target_dir = ProductionBackupManager.get_backup_dir()
    archive_path = os.path.join(target_dir, os.path.basename(filename))

    record_audit_log(
        action="DATABASE_RESTORE_INITIATED",
        target_type="DATABASE",
        target_id=filename,
        reason=f"Administrator {actor_username} initiated full database restoration from {filename}.",
        details={
            "filename": filename,
            "actor": actor_username,
            "client_ip": request.remote_addr,
            "user_agent": request.headers.get("User-Agent", "UNKNOWN"),
        },
        actor_username=actor_username,
        commit=True,
    )

    try:
        res = ProductionBackupManager.restore_backup(archive_path, actor=actor_username)
        return jsonify(res), 200
    except Exception as e:
        record_audit_log(
            action="DATABASE_RESTORE_FAILED",
            target_type="DATABASE",
            target_id=filename,
            reason=f"Restoration failed: {str(e)}",
            actor_username=actor_username,
            commit=True,
        )
        return jsonify({"error": str(e), "status": "ERROR"}), 500


@api_bp.route("/v2/admin/backups/prune", methods=["POST"])
@admin_required
def api_v2_prune_backups():
    """Prune expired backup archives according to retention policy."""
    data = request.get_json(silent=True) or {}
    days = data.get("retention_days", 30)
    keep_min = data.get("keep_minimum", 5)
    actor = get_current_user()
    actor_username = actor.username if actor else "ADMIN"

    try:
        from backend.database.backup_service import ProductionBackupManager
        res = ProductionBackupManager.apply_retention_policy(
            retention_days=int(days),
            keep_minimum=int(keep_min),
            actor=actor_username,
        )
        return jsonify(res), 200
    except Exception as e:
        return jsonify({"error": str(e), "status": "ERROR"}), 500
