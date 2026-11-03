with open("backend/web_ui/api_routes.py", "r", encoding="utf-8") as f:
    content = f.read()

target_status = """        return jsonify({"error": err}), 400
    return jsonify({
        "status": "UPDATED",
        "employee_id": emp.id,
        "employee_number": emp.employee_number,
        "new_status": emp.status,
    })"""

update_endpoint = """        return jsonify({"error": err}), 400
    return jsonify({
        "status": "UPDATED",
        "employee_id": emp.id,
        "employee_number": emp.employee_number,
        "new_status": emp.status,
    })


@api_bp.route("/employees/<int:emp_id>", methods=["PUT", "PATCH", "POST"])
@permission_required("employees.manage")
def api_update_employee(emp_id: int):
    \"\"\"Update employee profile information (department, job category, phone, names).\"\"\"
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
    }), 200"""

assert target_status in content, "target_status not found in api_routes.py"
content = content.replace(target_status, update_endpoint, 1)

target_summary = """@api_bp.route("/attendance/summary", methods=["GET"])
@login_required
def api_attendance_summary():
    \"\"\"Return dashboard summary stats.\"\"\"
    summary = get_hr_dashboard_summary(target_date=date.today())
    total_emp = Employee.query.filter_by(status="ACTIVE").count()

    return jsonify({
        "total_employees": total_emp,
        "present_count": summary["total_sessions"],
        "checkins_count": summary["total_checkins"],
        "checkouts_count": summary["total_checkouts"],
        "late_count": summary["late_count"],
        "on_time_count": summary["on_time_count"],
        "open_sessions_count": summary["open_sessions_count"],
        "unresolved_reviews": summary["open_review_cases_count"],
    })"""

enhanced_summary = """@api_bp.route("/attendance/summary", methods=["GET"])
@login_required
def api_attendance_summary():
    \"\"\"Return dashboard summary stats with live dynamic hourly and departmental breakdowns.\"\"\"
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
    })"""

assert target_summary in content, "target_summary not found in api_routes.py"
content = content.replace(target_summary, enhanced_summary, 1)

with open("backend/web_ui/api_routes.py", "w", encoding="utf-8") as f:
    f.write(content)

print("api_routes.py successfully updated!")

