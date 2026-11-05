"""
JSON REST API endpoints for Station Kiosks, HR Management, Scheduling, Reporting,
Security/RBAC enforcement, and Automated Acceptance Tests (AT-01 through AT-26).
"""
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
    admin_required,
)
from backend.employees.service import (
    create_department,
    create_employee,
    update_employee,
    set_employee_status,
)
from backend.face_engine.recognizer import recognize_face_candidate, compute_biometric_evaluation_metrics
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
            "role": user.role.name if user.role else None,
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
                })
    user = get_current_user()
    if user:
        return jsonify({
            "id": user.id,
            "username": user.username,
            "fullName": user.full_name,
            "role": user.role.name if user.role else None,
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


@api_bp.route("/departments", methods=["GET"])
@login_required
def api_departments():
    depts = Department.query.filter_by(status="ACTIVE").order_by(Department.name.asc()).all()
    return jsonify({
        "departments": [
            {
                "id": d.id,
                "name": d.name,
                "code": d.code,
            }
            for d in depts
        ]
    })


@api_bp.route("/employees", methods=["GET", "POST"])
@permission_required("employees.manage")
def api_employees():
    user = get_current_user()

    if request.method == "GET":
        q_str = request.args.get("q", "").strip()
        dept_id = request.args.get("department_id", type=int)

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
        res_list = []
        for e in emps:
            tmpl = e.active_template
            res_list.append({
                "id": e.id,
                "employee_number": e.employee_number,
                "first_name": e.first_name,
                "last_name": e.last_name,
                "full_name": e.full_name,
                "department_id": e.department_id,
                "department": e.department.name if e.department else "",
                "department_name": e.department.name if e.department else "",
                "job_category": e.job_category,
                "status": e.status,
                "consent_verified": bool(e.consent_verified),
                "has_active_template": tmpl is not None,
                "template_model_version": f"{tmpl.model_name} {tmpl.model_version}" if tmpl else None,
            })
        return jsonify({"employees": res_list})

    data = request.get_json(silent=True) or {}
    user = get_current_user()
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
        },
    }), 201


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
    emp_id = request.args.get("employee_id", type=int)
    q = ShiftAssignment.query
    if emp_id:
        q = q.filter_by(employee_id=emp_id)
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

    with transactional_session() as session:
        new_user = User(
            username=username,
            full_name=full_name,
            email=data.get("email"),
            password_hash=hash_password(password),
            role_id=role.id,
            status="ACTIVE",
        )
        session.add(new_user)
        session.flush()
        record_audit_log(
            action="USER_CREATED",
            target_type="USER",
            target_id=new_user.username,
            details={"role": role.name, "full_name": new_user.full_name},
            actor_user_id=actor.id if actor else None,
            actor_username=actor.username if actor else "ADMIN",
        )

    return jsonify({
        "id": new_user.id,
        "username": new_user.username,
        "role": role.name,
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
                "status": e.status,
                "has_active_template": e.active_template is not None,
                "consent_verified": e.consent_verified,
            }
            for e in employees
        ],
    }), 200


@api_bp.route("/station/quick-enroll", methods=["POST"])
def api_station_quick_enroll():
    """
    Quick biometric enrollment from Kiosk or Continuous Entrance camera modal.
    Requires live optical image_base64 and active employee_id.
    """
    data = request.get_json(silent=True) or {}
    emp_id = int(data.get("employee_id", 0))
    img_b64 = data.get("image_base64")
    if not emp_id or not img_b64:
        return jsonify({"error": "Both employee_id and live image_base64 are required."}), 400

    emp = db.session.get(Employee, emp_id)
    if not emp:
        return jsonify({"error": "Employee not found."}), 404

    if not emp.consent_verified:
        with transactional_session():
            emp.consent_verified = True
            emp.consent_verified_at = utc_now()

    user = get_current_user()
    tmpl, err = enroll_employee_face(
        emp_id,
        data,
        enrolled_by=user.username if user else "KIOSK_TERMINAL",
    )
    if err:
        return jsonify({"error": err}), 400
    return jsonify({
        "status": "ENROLLED",
        "template_id": tmpl.id,
        "quality_score": tmpl.quality_score,
        "message": f"Biometric template #{tmpl.id} enrolled for {emp.full_name}.",
    }), 200


@api_bp.route("/reports/export.csv", methods=["GET"])
@permission_required("reports.export")
def api_export_csv():
    """Export filtered attendance sessions to CSV respecting permissions and filters (AT-25)."""
    user = get_current_user()
    dept_id = request.args.get("department_id", type=int)
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
    dept_id = request.args.get("department_id", type=int)
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

    if not rec_result["matched"]:
        return jsonify({
            "matched": False,
            "status": rec_result["status"],
            "rejection_code": rec_result.get("rejection_code"),
            "rejection_message": rec_result.get("message"),
            "quality_score": rec_result.get("quality_score", 0.0),
            "match_score": rec_result.get("recognition_score", 0.0),
            "latency_ms": elapsed_ms,
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
        "latency_ms": elapsed_ms,
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
    summary = get_hr_dashboard_summary(target_date=date.today())
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
    depts = Department.query.order_by(Department.name).all()
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


@api_bp.route("/v2/entrance/gate-config", methods=["POST"])
def api_v2_entrance_config():
    """
    Configure gate mode (IN, OUT, AUTO_DETECT) and cooldown period for continuous gate.
    """
    data = request.get_json(silent=True) or {}
    st_code = data.get("station_code", "ST-GATE-01")
    gate_mode = data.get("gate_mode", "AUTO_DETECT")
    cooldown = data.get("cooldown_sec", 20)

    manager = ContinuousEntranceManager.get_instance()
    cfg = manager.configure_gate(st_code, gate_mode=gate_mode, cooldown_sec=cooldown)
    return jsonify({
        "station_code": st_code,
        "configured": True,
        "gate_config": cfg,
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
    return jsonify(res), 200
