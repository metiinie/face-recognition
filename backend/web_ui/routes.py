"""
Server-rendered HTML routes implementing all 6 Application Screens from Section 3
of the Implementation Blueprint:
  - Screen 1: Attendance Station (Employee-facing Kiosk)
  - Screen 2: Employee Management & Biometric Enrollment
  - Screen 3: HR Dashboard
  - Screen 4: Attendance Records & CSV Reports
  - Screen 5: Schedule & Station Management
  - Screen 6: Users, Review Queue, Attendance Corrections, Audit & Policy Sign-off
"""
from datetime import datetime, date
from flask import (
    Blueprint,
    current_app,
    render_template,
    request,
    redirect,
    url_for,
    flash,
    session,
    Response,
)
from backend.database import db, transactional_session
from backend.database.models import (
    User,
    Role,
    Department,
    Employee,
    FaceTemplate,
    AttendanceStation,
    ShiftTemplate,
    ShiftAssignment,
    ScheduleException,
    AttendanceSession,
    AttendanceEvent,
    ReviewCase,
    AttendanceCorrection,
    AuditLog,
    PolicySignoff,
    utc_to_local,
    local_to_utc,
    utc_now,
    format_ethiopian_clock_from_24h,
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
from backend.face_enrollment.service import (
    enroll_employee_face,
    revoke_employee_templates,
)
from backend.stations.service import register_station, resolve_station_from_binding
from backend.security.tokens import issue_station_binding
from backend.shifts.service import (
    create_shift_template,
    assign_shift_to_employee,
    create_schedule_exception,
)
from backend.attendance.service import flag_overdue_open_sessions
from backend.attendance_review.service import (
    record_manual_hr_attendance,
    apply_attendance_correction,
)
from backend.reports.service import (
    get_hr_dashboard_summary,
    query_attendance_sessions,
    export_sessions_to_csv,
)
from backend.audit.service import record_audit_log

web_ui_bp = Blueprint("web_ui", __name__)


@web_ui_bp.app_context_processor
def inject_globals():
    now_local = utc_to_local(utc_now())
    eth_clock_now = format_ethiopian_clock_from_24h(now_local.hour, now_local.minute)
    return {
        "current_user": get_current_user(),
        "now_local_str": now_local.strftime("%Y-%m-%d %H:%M EAT"),
        "eth_clock_now": eth_clock_now,
        "utc_to_local": utc_to_local,
        "institution_name": "Ethio-Italy Polytechnic College, Dire Dawa",
    }


@web_ui_bp.route("/login", methods=["GET", "POST"])
def login_page():
    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        user, err = authenticate_user(username, password)
        if err:
            flash(err, "danger")
            return render_template("login.html"), 401
        flash(f"Welcome back, {user.full_name} ({user.role.name}).", "success")
        next_url = request.args.get("next") or url_for("web_ui.hr_dashboard")
        return redirect(next_url)
    return render_template("login.html")


@web_ui_bp.route("/logout")
def logout_page():
    user = get_current_user()
    if user:
        record_audit_log(
            action="AUTH_LOGOUT",
            target_type="USER",
            target_id=user.id,
            actor_user_id=user.id,
            actor_username=user.username,
            commit=True,
        )
    session.clear()
    flash("You have been logged out.", "info")
    return redirect(url_for("web_ui.login_page"))


# ==============================================================================
# SCREEN 1 — Attendance Station (Employee-facing Kiosk)
# ==============================================================================
@web_ui_bp.route("/")
@web_ui_bp.route("/station")
def station_kiosk():
    """
    The kiosk's station identity comes only from the signed binding cookie set by an
    administrator via /station/provision. No station secrets are rendered into the page.
    """
    cookie = request.cookies.get(current_app.config.get("STATION_COOKIE_NAME", "eipc_station"))
    active_station, binding_error = (None, None)
    if cookie:
        active_station, binding_error = resolve_station_from_binding(cookie)

    allow_sim = current_app.config.get("ALLOW_SIMULATED_BIOMETRICS", False)
    enrolled_employees = (
        Employee.query.order_by(Employee.employee_number.asc()).all() if allow_sim else []
    )
    return render_template(
        "station_kiosk.html",
        active_station=active_station,
        binding_error=binding_error,
        allow_sim=allow_sim,
        enrolled_employees=enrolled_employees,
    )


@web_ui_bp.route("/station/provision", methods=["GET", "POST"])
@admin_required
def station_provision():
    """
    Administrator binds this browser/device to one departmental station (trusted configuration).
    The admin session is cleared afterwards so the kiosk is never left logged in.
    """
    user = get_current_user()
    cookie_name = current_app.config.get("STATION_COOKIE_NAME", "eipc_station")

    if request.method == "POST":
        if request.form.get("form_action") == "unbind":
            record_audit_log(
                action="STATION_DEVICE_UNBOUND",
                target_type="STATION_DEVICE",
                actor_user_id=user.id,
                actor_username=user.username,
                commit=True,
            )
            resp = redirect(url_for("web_ui.station_provision"))
            resp.delete_cookie(cookie_name)
            flash("This device is no longer bound to a station.", "info")
            return resp

        code = (request.form.get("station_code") or "").strip().upper()
        station = AttendanceStation.query.filter_by(station_code=code).first()
        if not station or station.status != "ACTIVE":
            flash("Select an active station to provision.", "danger")
            return redirect(url_for("web_ui.station_provision"))

        record_audit_log(
            action="STATION_DEVICE_PROVISIONED",
            target_type="STATION",
            target_id=station.station_code,
            details={"user_agent": request.headers.get("User-Agent", "")[:200]},
            actor_user_id=user.id,
            actor_username=user.username,
            station_id=station.id,
            commit=True,
        )
        resp = redirect(url_for("web_ui.station_kiosk"))
        resp.set_cookie(
            cookie_name,
            issue_station_binding(station),
            max_age=365 * 24 * 3600,
            httponly=True,
            samesite="Strict",
            secure=request.is_secure,
        )
        session.clear()
        flash(
            f"This device is now station {station.station_code}. The administrator session was signed out.",
            "success",
        )
        return resp

    current_cookie = request.cookies.get(cookie_name)
    bound_station, _ = resolve_station_from_binding(current_cookie) if current_cookie else (None, None)
    stations = AttendanceStation.query.filter_by(status="ACTIVE").order_by(AttendanceStation.station_code.asc()).all()
    return render_template("station_provision.html", stations=stations, bound_station=bound_station)


# ==============================================================================
# SCREEN 2 — Employee Management & Biometric Enrollment
# ==============================================================================
@web_ui_bp.route("/employees", methods=["GET", "POST"])
@permission_required("employees.manage")
def employees_screen():
    user = get_current_user()
    if request.method == "POST":
        form_action = request.form.get("form_action", "create_employee")

        if form_action == "create_employee":
            emp, err = create_employee(
                employee_number=request.form.get("employee_number", ""),
                first_name=request.form.get("first_name", ""),
                last_name=request.form.get("last_name", ""),
                department_id=int(request.form.get("department_id", 0)),
                job_category=request.form.get("job_category", "REGULAR_STAFF"),
                phone=request.form.get("phone", ""),
                consent_verified=request.form.get("consent_verified") == "on",
                actor=user.username,
            )
            if err:
                flash(err, "danger")
            else:
                # Optionally auto-enroll initial face template if requested
                if request.form.get("auto_enroll_face") == "on":
                    enroll_employee_face(
                        employee_id=emp.id,
                        capture_payload={
                            "biometric_signature": f"FACE_SIG_{emp.employee_number}",
                            "quality_metrics": {"brightness": 132.0, "sharpness": 90.0, "face_detected": True},
                        },
                        enrolled_by=user.username,
                    )
                # Optionally assign shift if selected
                shift_tmpl_id = request.form.get("shift_template_id")
                if shift_tmpl_id and shift_tmpl_id.isdigit():
                    assign_shift_to_employee(
                        employee_id=emp.id,
                        shift_template_id=int(shift_tmpl_id),
                        effective_from=utc_to_local(utc_now()).date(),
                        approved_by=user.username,
                    )
                flash(f"Employee {emp.full_name} ({emp.employee_number}) registered successfully.", "success")

        elif form_action == "toggle_status":
            emp_id = int(request.form.get("employee_id", 0))
            new_status = request.form.get("new_status", "INACTIVE")
            reason = request.form.get("reason", "HR status change")
            emp, err = set_employee_status(emp_id, new_status, reason, user.username)
            if err:
                flash(err, "danger")
            else:
                flash(f"Employee {emp.employee_number} status changed to {emp.status}. Historical records preserved.", "info")

        elif form_action == "enroll_face":
            emp_id = int(request.form.get("employee_id", 0))
            emp = db.session.get(Employee, emp_id)
            quality_mode = request.form.get("quality_mode", "GOOD")
            img_b64 = request.form.get("image_base64", "").strip()
            payload = {}
            if img_b64:
                payload["image_base64"] = img_b64
            elif emp:
                payload["biometric_signature"] = f"FACE_SIG_{emp.employee_number}"

            if quality_mode == "POOR_DARK":
                payload["quality_metrics"] = {"brightness": 22.0, "sharpness": 80.0, "face_detected": True}
            elif quality_mode == "BLURRY":
                payload["quality_metrics"] = {"brightness": 120.0, "sharpness": 14.0, "face_detected": True}
            elif quality_mode == "OBSTRUCTED":
                payload["quality_metrics"] = {"brightness": 120.0, "sharpness": 80.0, "face_detected": False, "obstructed": True}
            else:
                payload["quality_metrics"] = {"brightness": 135.0, "sharpness": 92.0, "face_detected": True}

            tmpl, err = enroll_employee_face(emp_id, payload, enrolled_by=user.username)
            if err:
                flash(f"Enrollment Rejected: {err}", "danger")
            else:
                flash(
                    f"Biometric template #{tmpl.id} enrolled and encrypted at rest (quality: {tmpl.quality_score}).",
                    "success",
                )

        elif form_action == "revoke_face":
            emp_id = int(request.form.get("employee_id", 0))
            reason = request.form.get("revoke_reason", "HR template revocation")
            cnt, err = revoke_employee_templates(emp_id, reason, revoked_by=user.username)
            if err:
                flash(err, "danger")
            else:
                flash(f"Revoked {cnt} active biometric template(s).", "warning")

        return redirect(url_for("web_ui.employees_screen"))

    # Search and filter
    search_q = request.args.get("q", "").strip()
    dept_filter = request.args.get("department_id", type=int)
    cat_filter = request.args.get("job_category", "").strip()
    status_filter = request.args.get("status", "").strip()

    q = Employee.query
    if search_q:
        like_pat = f"%{search_q}%"
        q = q.filter(
            db.or_(
                Employee.employee_number.ilike(like_pat),
                Employee.first_name.ilike(like_pat),
                Employee.last_name.ilike(like_pat),
            )
        )
    if dept_filter:
        q = q.filter_by(department_id=dept_filter)
    if cat_filter:
        q = q.filter_by(job_category=cat_filter)
    if status_filter:
        q = q.filter_by(status=status_filter)

    employees = q.order_by(Employee.employee_number.asc()).all()
    departments = Department.query.order_by(Department.name.asc()).all()
    shift_templates = ShiftTemplate.query.filter_by(status="ACTIVE").all()

    return render_template(
        "employees.html",
        employees=employees,
        departments=departments,
        shift_templates=shift_templates,
        search_q=search_q,
        dept_filter=dept_filter,
        cat_filter=cat_filter,
        status_filter=status_filter,
    )


# ==============================================================================
# SCREEN 3 — HR Dashboard
# ==============================================================================
@web_ui_bp.route("/dashboard")
@permission_required("reports.view")
def hr_dashboard():
    date_str = request.args.get("date")
    dept_id = request.args.get("department_id", type=int)
    emp_id = request.args.get("employee_id", type=int)

    target_date = date.fromisoformat(date_str) if date_str else None
    summary = get_hr_dashboard_summary(
        target_date=target_date,
        department_id=dept_id,
        employee_id=emp_id,
    )
    departments = Department.query.order_by(Department.name.asc()).all()
    employees = Employee.query.order_by(Employee.employee_number.asc()).all()

    return render_template(
        "dashboard.html",
        summary=summary,
        departments=departments,
        employees=employees,
        selected_date=date_str or "",
        selected_dept=dept_id,
        selected_emp=emp_id,
    )


# ==============================================================================
# SCREEN 4 — Attendance Records and Reports
# ==============================================================================
@web_ui_bp.route("/reports")
@permission_required("reports.view")
def reports_screen():
    dept_id = request.args.get("department_id", type=int)
    emp_id = request.args.get("employee_id", type=int)
    status = request.args.get("status", "").strip() or None
    arrival_status = request.args.get("arrival_status", "").strip() or None
    capture_method = request.args.get("capture_method", "").strip() or None
    date_from_str = request.args.get("date_from", "").strip()
    date_to_str = request.args.get("date_to", "").strip()

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
    raw_events = (
        AttendanceEvent.query.order_by(AttendanceEvent.occurred_at.desc(), AttendanceEvent.id.desc())
        .limit(50)
        .all()
    )
    departments = Department.query.order_by(Department.name.asc()).all()
    employees = Employee.query.order_by(Employee.employee_number.asc()).all()

    return render_template(
        "reports.html",
        sessions=sessions,
        raw_events=raw_events,
        departments=departments,
        employees=employees,
        filters={
            "department_id": dept_id,
            "employee_id": emp_id,
            "status": status or "",
            "arrival_status": arrival_status or "",
            "capture_method": capture_method or "",
            "date_from": date_from_str,
            "date_to": date_to_str,
        },
    )


# ==============================================================================
# SCREEN 5 — Schedule and Station Management
# ==============================================================================
@web_ui_bp.route("/schedules-stations", methods=["GET", "POST"])
@permission_required("schedules.manage")
def schedules_stations_screen():
    user = get_current_user()
    if request.method == "POST":
        action = request.form.get("form_action", "")

        if action == "create_shift":
            tmpl, err = create_shift_template(
                name=request.form.get("name", ""),
                job_category=request.form.get("job_category", "REGULAR_STAFF"),
                start_time=request.form.get("start_time", "08:00"),
                end_time=request.form.get("end_time", "17:00"),
                grace_period_minutes=int(request.form.get("grace_period_minutes", 15)),
                spans_midnight=request.form.get("spans_midnight") == "on",
                is_24_hour=request.form.get("is_24_hour") == "on",
                break_rules=request.form.get("break_rules", "60 min lunch break"),
                hr_approved=request.form.get("hr_approved") == "on",
                actor=user.username,
            )
            flash(err if err else f"Shift template '{tmpl.name}' created.", "danger" if err else "success")

        elif action == "assign_shift":
            eff_from_str = request.form.get("effective_from")
            eff_to_str = request.form.get("effective_to")
            assign, err = assign_shift_to_employee(
                employee_id=int(request.form.get("employee_id", 0)),
                shift_template_id=int(request.form.get("shift_template_id", 0)),
                effective_from=date.fromisoformat(eff_from_str) if eff_from_str else utc_to_local(utc_now()).date(),
                effective_to=date.fromisoformat(eff_to_str) if eff_to_str else None,
                working_days=request.form.get("working_days", "0,1,2,3,4"),
                approved_by=user.username,
            )
            flash(err if err else "Effective-dated schedule assigned successfully.", "danger" if err else "success")

        elif action == "create_exception":
            exc, err = create_schedule_exception(
                title=request.form.get("title", ""),
                exception_type=request.form.get("exception_type", "PUBLIC_HOLIDAY"),
                start_date=date.fromisoformat(request.form.get("start_date")),
                end_date=date.fromisoformat(request.form.get("end_date")),
                employee_id=int(request.form["employee_id"]) if request.form.get("employee_id") else None,
                reason=request.form.get("reason", ""),
                approved_by=user.username,
            )
            flash(err if err else f"Schedule exception '{exc.title}' added.", "danger" if err else "success")

        elif action == "register_station":
            if not user.role or user.role.name != "ADMIN":
                flash("Only System Administrators can register new hardware stations.", "danger")
            else:
                st, err = register_station(
                    station_code=request.form.get("station_code", ""),
                    name=request.form.get("name", ""),
                    department_id=int(request.form.get("department_id", 0)),
                    location=request.form.get("location", ""),
                    station_secret_token=request.form.get("station_secret_token") or None,
                    actor=user.username,
                )
                flash(err if err else f"Station '{st.station_code}' registered.", "danger" if err else "success")

        elif action == "create_department":
            dept, err = create_department(
                name=request.form.get("dept_name", ""),
                code=request.form.get("dept_code", ""),
                actor=user.username,
            )
            flash(err if err else f"Department '{dept.name}' created.", "danger" if err else "success")

        return redirect(url_for("web_ui.schedules_stations_screen"))

    shift_templates = ShiftTemplate.query.order_by(ShiftTemplate.id.asc()).all()
    assignments = ShiftAssignment.query.order_by(ShiftAssignment.effective_from.desc()).all()
    exceptions = ScheduleException.query.order_by(ScheduleException.start_date.desc()).all()
    stations = AttendanceStation.query.order_by(AttendanceStation.station_code.asc()).all()
    departments = Department.query.order_by(Department.name.asc()).all()
    employees = Employee.query.filter_by(status="ACTIVE").order_by(Employee.employee_number.asc()).all()

    return render_template(
        "schedules_stations.html",
        shift_templates=shift_templates,
        assignments=assignments,
        exceptions=exceptions,
        stations=stations,
        departments=departments,
        employees=employees,
    )


# ==============================================================================
# SCREEN 6 — Users, Review Queue, Corrections, Audit & Policy Sign-off
# ==============================================================================
@web_ui_bp.route("/users-review-audit", methods=["GET", "POST"])
@login_required
def users_review_audit_screen():
    user = get_current_user()
    if request.method == "POST":
        action = request.form.get("form_action", "")

        if action == "manual_attendance":
            if not user.has_permission("attendance.review"):
                flash("Forbidden: You do not have permission to record manual attendance.", "danger")
            else:
                occ_str = request.form.get("occurred_at_local", "").strip()
                occ_utc = local_to_utc(datetime.fromisoformat(occ_str)) if occ_str else None
                rc_id = request.form.get("review_case_id")
                res, err = record_manual_hr_attendance(
                    hr_user=user,
                    employee_id=int(request.form.get("employee_id", 0)),
                    station_id=int(request.form.get("station_id", 0)),
                    event_type=request.form.get("event_type", "CHECK_IN"),
                    reason=request.form.get("reason", ""),
                    evidence_reference=request.form.get("evidence_reference", ""),
                    occurred_at=occ_utc,
                    review_case_id=int(rc_id) if (rc_id and rc_id.isdigit()) else None,
                )
                flash(
                    err if err else f"Manual HR {res['event_type']} recorded for {res['employee_name']} (distinguished as MANUAL_HR).",
                    "danger" if err else "success",
                )

        elif action == "correct_attendance":
            if not user.has_permission("attendance.correct"):
                flash("Forbidden: You do not have permission to correct attendance.", "danger")
            else:
                corr_str = request.form.get("corrected_timestamp_local", "").strip()
                if not corr_str:
                    flash("Corrected local timestamp is required.", "danger")
                else:
                    corr_utc = local_to_utc(datetime.fromisoformat(corr_str))
                    corr, err = apply_attendance_correction(
                        hr_user=user,
                        session_id=int(request.form.get("session_id", 0)),
                        correction_type=request.form.get("correction_type", "CHECK_IN_TIME"),
                        corrected_timestamp_utc=corr_utc,
                        reason=request.form.get("reason", ""),
                        evidence_ref=request.form.get("evidence_ref", "HR-CORR-DOC"),
                    )
                    flash(
                        err if err else f"Correction #{corr.id} applied. Original event preserved in history and audit trail recorded.",
                        "danger" if err else "success",
                    )

        elif action == "create_user":
            if not user.role or user.role.name != "ADMIN":
                flash("Access Denied: Only System Administrators can create user accounts (AT-22).", "danger")
            else:
                uname = request.form.get("username", "").strip()
                fname = request.form.get("full_name", "").strip()
                pwd = request.form.get("password", "")
                rname = request.form.get("role_name", "HR_OFFICER")
                role = Role.query.filter_by(name=rname).first()
                if User.query.filter_by(username=uname).first():
                    flash(f"Username '{uname}' already exists.", "danger")
                elif not uname or not fname or len(pwd) < 6 or not role:
                    flash("Valid username, full name, role, and password (>=6 chars) required.", "danger")
                else:
                    with transactional_session() as s:
                        nu = User(
                            username=uname,
                            full_name=fname,
                            email=request.form.get("email") or None,
                            password_hash=hash_password(pwd),
                            role_id=role.id,
                            status="ACTIVE",
                        )
                        s.add(nu)
                        s.flush()
                        record_audit_log(
                            action="USER_CREATED",
                            target_type="USER",
                            target_id=nu.username,
                            details={"role": role.name},
                            actor_user_id=user.id,
                            actor_username=user.username,
                        )
                    flash(f"User '{uname}' ({role.name}) created.", "success")

        elif action == "toggle_user_status":
            if not user.role or user.role.name != "ADMIN":
                flash("Access Denied: Only System Administrators can modify user accounts.", "danger")
            else:
                target_u = db.session.get(User, int(request.form.get("target_user_id", 0)))
                if target_u and target_u.id != user.id:
                    with transactional_session():
                        target_u.status = "INACTIVE" if target_u.status == "ACTIVE" else "ACTIVE"
                        record_audit_log(
                            action=f"USER_{target_u.status}",
                            target_type="USER",
                            target_id=target_u.username,
                            actor_user_id=user.id,
                            actor_username=user.username,
                        )
                    flash(f"User '{target_u.username}' is now {target_u.status}.", "info")

        elif action == "update_policy":
            pol_id = int(request.form.get("policy_id", 0))
            pol = db.session.get(PolicySignoff, pol_id)
            if pol:
                with transactional_session():
                    pol.status = request.form.get("status", "CONFIRMED")
                    pol.decision_notes = request.form.get("decision_notes", "")
                    pol.confirmed_by = user.full_name
                    record_audit_log(
                        action="POLICY_SIGNOFF_UPDATED",
                        target_type="POLICY",
                        target_id=pol.policy_code,
                        details={"status": pol.status, "notes": pol.decision_notes},
                        actor_user_id=user.id,
                        actor_username=user.username,
                    )
                flash(f"Policy '{pol.policy_code}' updated to {pol.status}.", "success")

        elif action == "flag_overdue_sessions":
            cnt = flag_overdue_open_sessions()
            flash(f"Scanned open sessions: {cnt} overdue session(s) flagged for review without inventing check-out times.", "info")

        return redirect(url_for("web_ui.users_review_audit_screen"))

    review_cases = ReviewCase.query.order_by(ReviewCase.created_at.desc()).all()
    corrections = AttendanceCorrection.query.order_by(AttendanceCorrection.created_at.desc()).all()
    audit_logs = AuditLog.query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(100).all()
    users = User.query.order_by(User.id.asc()).all()
    roles = Role.query.all()
    employees = Employee.query.filter_by(status="ACTIVE").order_by(Employee.employee_number.asc()).all()
    stations = AttendanceStation.query.filter_by(status="ACTIVE").all()
    sessions = AttendanceSession.query.order_by(AttendanceSession.id.desc()).limit(30).all()
    policies = PolicySignoff.query.order_by(PolicySignoff.id.asc()).all()

    return render_template(
        "users_review_audit.html",
        review_cases=review_cases,
        corrections=corrections,
        audit_logs=audit_logs,
        users=users,
        roles=roles,
        employees=employees,
        stations=stations,
        sessions=sessions,
        policies=policies,
    )

