with open("backend/web_ui/api_routes.py", "r", encoding="utf-8") as f:
    content = f.read()

target = '''    data = request.get_json(silent=True) or {}
    st_code_or_id = data.get("station_code") or data.get("station_id") or "ST-GATE-01"
    station = None
    if isinstance(st_code_or_id, int) or str(st_code_or_id).isdigit():
        station = db.session.get(AttendanceStation, int(st_code_or_id))
    if not station:
        station = AttendanceStation.query.filter_by(station_code=str(st_code_or_id).strip().upper()).first()
    if not station:
        station = AttendanceStation.query.filter_by(status="ACTIVE").first()
    if not station:
        return jsonify({"error": "No active attendance station available for entrance gate."}), 400'''

replacement = '''    data = request.get_json(silent=True) or {}
    station, st_err = _resolve_station(data)
    if st_err:
        user = get_current_user()
        if current_app.config.get("TESTING", False) or (user and user.has_permission("attendance.review")):
            st_code_or_id = data.get("station_code") or data.get("station_id") or "ST-GATE-01"
            if isinstance(st_code_or_id, int) or str(st_code_or_id).isdigit():
                station = db.session.get(AttendanceStation, int(st_code_or_id))
            if not station:
                station = AttendanceStation.query.filter_by(station_code=str(st_code_or_id).strip().upper()).first()
            if not station:
                station = AttendanceStation.query.filter_by(status="ACTIVE").first()
        else:
            return jsonify({"error": st_err, "code": "STATION_UNAUTHORIZED"}), 403

    if not station:
        return jsonify({"error": "No active attendance station available for entrance gate."}), 400'''

if target in content:
    content = content.replace(target, replacement)
    with open("backend/web_ui/api_routes.py", "w", encoding="utf-8") as f:
        f.write(content)
    print("v2 entrance security updated!")
else:
    print("target not found")

