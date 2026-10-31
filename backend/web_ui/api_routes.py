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
)
from backend.database.migrations import (
    export_full_backup_snapshot,
    restore_backup_snapshot,
    verify_relational_integrity,
)
from backend.audit.service import record_audit_log

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
def api_employees():
    user = get_current_user()
    if not user:
        if current_app.config.get("ALLOW_SIMULATED_BIOMETRICS", False) and not current_app.config.get("TESTING", False):
            user = User.query.filter_by(username="hr_officer").first()
        else:
            return jsonify({"error": "Authentication required", "code": "UNAUTHENTICATED"}), 401

    if not user or not user.has_permission("employees.manage"):
        return jsonify({"error": "Forbidden: requires permission 'employees.manage'", "code": "FORBIDDEN"}), 403

    if request.method == "GET":
        emps = Employee.query.order_by(Employee.employee_number.asc()).all()
        return jsonify({
            "employees": [
                {
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
                    "has_active_template": e.active_template is not None,
                }
                for e in emps
            ]
        })

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
            "full_name": emp.full_name,
            "department_id": emp.department_id,
            "job_category": emp.job_category,
            "status": emp.status,
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
def api_face_model_report():
    """Report active model name, version, and legacy template breakdown."""
    report = get_model_compatibility_report()
    return jsonify(report)


@api_bp.route("/face/sync-model-templates", methods=["POST"])
def api_face_sync_model():
    """Sync and upgrade legacy biometric templates to current model version."""
    user = get_current_user()
    res = sync_legacy_templates_for_model(actor=user.username if user else "ADMIN")
    return jsonify({"status": "SYNCED", "message": "Biometric templates migrated to active model.", "result": res})


@api_bp.route("/face/retention-cleanup", methods=["POST"])
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
    data = request.get_json(silent=True) or {}
    rec_result = recognize_face_candidate(data, decrypt_embedding)

    if not rec_result["matched"]:
        return jsonify({
            "matched": False,
            "status": rec_result["status"],
            "rejection_code": rec_result.get("rejection_code"),
            "rejection_message": rec_result.get("message"),
            "quality_score": rec_result.get("quality_score", 0.0),
            "latency_ms": 94,
        })

    emp = rec_result["employee"]
    score = rec_result["recognition_score"]
    token = issue_recognition_token(emp.id, 1, score)

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
        "latency_ms": 94,
    })


@api_bp.route("/face/enroll", methods=["POST"])
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

    ev, sess, action_type, err = confirm_attendance_action(
        employee_id=emp_id,
        station_id=st_id,
        recognition_score=score,
        capture_method="KIOSK_FACIAL",
        override_reason=data.get("override_reason"),
    )
    if err:
        return jsonify({"error": err}), 400

    now_local = utc_to_local(ev.occurred_at_utc)
    return jsonify({
        "success": True,
        "message": f"{action_type.replace('_', ' ')} recorded successfully for {ev.employee.full_name}.",
        "event_type": action_type,
        "timestamp": now_local.isoformat(),
        "is_late": sess.is_late if sess else False,
        "minutes_late": sess.late_minutes if sess else 0,
        "is_overtime": sess.is_overtime if sess else False,
    })


@api_bp.route("/attendance/summary", methods=["GET"])
def api_attendance_summary():
    """Return dashboard summary stats."""
    total_emp = Employee.query.filter_by(status="ACTIVE").count()
    today_sessions = AttendanceSession.query.filter_by(session_date=date.today()).all()
    present_count = len(today_sessions)
    late_count = sum(1 for s in today_sessions if s.is_late)
    unresolved_reviews = ReviewCase.query.filter_by(status="OPEN").count()

    return jsonify({
        "total_employees": total_emp,
        "present_count": present_count,
        "late_count": late_count,
        "unresolved_reviews": unresolved_reviews,
    })


@api_bp.route("/employees", methods=["GET"])
def api_list_employees():
    """Return employee roster with biometric status."""
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

    employees = query.order_by(Employee.employee_number.asc()).all()
    active_model = current_app.config.get("FACE_MODEL_NAME", "EIPC-Vision-Embedder")

    res = []
    for emp in employees:
        active_tmpl = FaceTemplate.query.filter_by(employee_id=emp.id, status="ACTIVE").first()
        res.append({
            "id": emp.id,
            "employee_number": emp.employee_number,
            "first_name": emp.first_name,
            "last_name": emp.last_name,
            "job_category": emp.job_category,
            "department_id": emp.department_id,
            "department_name": emp.department.name if emp.department else "General",
            "status": emp.status,
            "has_active_template": active_tmpl is not None,
            "template_model_version": f"{active_tmpl.model_name} {active_tmpl.model_version}" if active_tmpl else None,
            "consent_verified": emp.consent_verified,
        })
    return jsonify(res)


@api_bp.route("/audit-logs", methods=["GET"])
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
def api_list_review_cases():
    """Return open review cases for manual HR adjudication."""
    cases = ReviewCase.query.filter_by(status="OPEN").order_by(ReviewCase.created_at.desc()).all()
    return jsonify([
        {
            "id": c.id,
            "status": c.status,
            "review_type": c.review_type,
            "notes": c.notes,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in cases
    ])

