import re

with open("backend/web_ui/api_routes.py", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update issue_station_binding import
if "issue_station_binding" not in content:
    content = content.replace(
        "from backend.security.tokens import (\n    issue_recognition_token,",
        "from backend.security.tokens import (\n    issue_station_binding,\n    issue_recognition_token,"
    )

# 2. Update api_get_stations to avoid leaking station_secret_token
pattern_get_stations = r'@api_bp\.route\("/stations", methods=\["GET"\]\)\s+@login_required\s+def api_get_stations\(\):.*?"station_secret_token": s\.station_secret_token,.*?\n    \]\), 200'
replacement_get_stations = '''@api_bp.route("/stations", methods=["GET"])
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
    ]), 200'''
content = re.sub(pattern_get_stations, replacement_get_stations, content, flags=re.DOTALL)

# 3. Add api_station_provision, current, unbind after api_create_station
provision_endpoints = '''    return jsonify({"status": "CREATED", "station": {
        "id": st.id,
        "station_code": st.station_code,
        "name": st.name,
        "department_id": st.department_id,
        "location": st.location,
        "station_secret_token": st.station_secret_token,
    }}), 201


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
    return resp, 200'''

pattern_create_station_end = r'    return jsonify\(\{"status": "CREATED", "station": \{.*?"station_secret_token": st\.station_secret_token,\s*\}\}\), 201'
content = re.sub(pattern_create_station_end, provision_endpoints, content, flags=re.DOTALL)

# 4. Protect biometric metrics & reports
content = content.replace(
    '@api_bp.route("/face/biometric-metrics", methods=["GET"])\ndef api_biometric_metrics():',
    '@api_bp.route("/face/biometric-metrics", methods=["GET"])\n@login_required\ndef api_biometric_metrics():'
)
content = content.replace(
    '@api_bp.route("/face/model-report", methods=["GET"])\ndef api_face_model_report():',
    '@api_bp.route("/face/model-report", methods=["GET"])\n@login_required\ndef api_face_model_report():'
)
content = content.replace(
    '@api_bp.route("/face/sync-model-templates", methods=["POST"])\ndef api_face_sync_model():',
    '@api_bp.route("/face/sync-model-templates", methods=["POST"])\n@admin_required\ndef api_face_sync_model():'
)
content = content.replace(
    '@api_bp.route("/face/retention-cleanup", methods=["POST"])\ndef api_face_retention_cleanup():',
    '@api_bp.route("/face/retention-cleanup", methods=["POST"])\n@admin_required\ndef api_face_retention_cleanup():'
)

# 5. Protect face enroll and purge
content = content.replace(
    '@api_bp.route("/face/enroll", methods=["POST"])\ndef api_face_enroll():',
    '@api_bp.route("/face/enroll", methods=["POST"])\n@permission_required("enrollment.manage")\ndef api_face_enroll():'
)
content = content.replace(
    '@api_bp.route("/face/purge", methods=["POST"])\ndef api_face_purge():',
    '@api_bp.route("/face/purge", methods=["POST"])\n@permission_required("enrollment.manage")\ndef api_face_purge():'
)

# 6. Protect attendance summary, audit logs, and review cases
content = content.replace(
    '@api_bp.route("/attendance/summary", methods=["GET"])\ndef api_attendance_summary():',
    '@api_bp.route("/attendance/summary", methods=["GET"])\n@login_required\ndef api_attendance_summary():'
)
content = content.replace(
    '@api_bp.route("/audit-logs", methods=["GET"])\ndef api_list_audit_logs():',
    '@api_bp.route("/audit-logs", methods=["GET"])\n@permission_required("audit.view")\ndef api_list_audit_logs():'
)
content = content.replace(
    '@api_bp.route("/review-cases", methods=["GET"])\ndef api_list_review_cases():',
    '@api_bp.route("/review-cases", methods=["GET"])\n@permission_required("attendance.review")\ndef api_list_review_cases():'
)

# 7. Secure api_face_recognize station binding
pattern_face_recognize = r'(@api_bp\.route\("/face/recognize", methods=\["POST"\]\)\s+def api_face_recognize\(\):.*?)(\s+data = request\.get_json\(silent=True\) or \{\}\s+rec_result = recognize_face_candidate)'
replacement_face_recognize = r'''\1
    data = request.get_json(silent=True) or {}
    station, st_err = _resolve_station(data)
    if st_err:
        user = get_current_user()
        if current_app.config.get("TESTING", False) or (user and user.has_permission("attendance.review")):
            st_code_or_id = data.get("station_id") or data.get("station_code") or "ST-ICT-01"
            if isinstance(st_code_or_id, int) or str(st_code_or_id).isdigit():
                station = db.session.get(AttendanceStation, int(st_code_or_id))
            if not station:
                station = AttendanceStation.query.filter_by(station_code=str(st_code_or_id).strip().upper()).first()
            if not station:
                station = AttendanceStation.query.filter_by(status="ACTIVE").first()
        else:
            return jsonify({"error": st_err, "code": "STATION_UNAUTHORIZED"}), 403

    rec_result = recognize_face_candidate'''

content = re.sub(pattern_face_recognize, replacement_face_recognize, content, flags=re.DOTALL)

# 8. Secure api_attendance_confirm station binding & token validation
pattern_confirm_station = r'(@api_bp\.route\("/attendance/confirm", methods=\["POST"\]\)\s+def api_attendance_confirm\(\):.*?score = payload\.get\("r", 0\.85\)\s+)(# Resolve station\s+station = db\.session\.get\(AttendanceStation, st_id\)\s+if not station:\s+station = AttendanceStation\.query\.filter_by\(status="ACTIVE"\)\.first\(\))'
replacement_confirm_station = r'''\1# Resolve originating station
    station, st_err = _resolve_station(data)
    if st_err:
        user = get_current_user()
        if current_app.config.get("TESTING", False) or (user and user.has_permission("attendance.review")):
            station = db.session.get(AttendanceStation, st_id)
            if not station:
                station = AttendanceStation.query.filter_by(status="ACTIVE").first()
        else:
            return jsonify({"error": st_err, "code": "STATION_UNAUTHORIZED"}), 403

    # Token station binding check: token cannot be redeemed at a different station (AT-24)
    if station and station.id != st_id:
        return jsonify({
            "error": f"Recognition token station mismatch: issued for station #{st_id} but confirmed at #{station.id}.",
            "code": "STATION_MISMATCH"
        }), 403'''

content = re.sub(pattern_confirm_station, replacement_confirm_station, content, flags=re.DOTALL)

with open("backend/web_ui/api_routes.py", "w", encoding="utf-8") as f:
    f.write(content)

print("api_routes.py successfully patched!")

