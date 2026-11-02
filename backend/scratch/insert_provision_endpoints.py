with open("backend/web_ui/api_routes.py", "r", encoding="utf-8") as f:
    content = f.read()

target = '''    return jsonify({
        "id": st.id,
        "station_code": st.station_code,
        "station_secret_token": st.station_secret_token,
    }), 201'''

replacement = '''    return jsonify({
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
    return resp, 200'''

if target in content:
    content = content.replace(target, replacement)
    with open("backend/web_ui/api_routes.py", "w", encoding="utf-8") as f:
        f.write(content)
    print("Provision endpoints added successfully!")
else:
    print("Target not found!")

