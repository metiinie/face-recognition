"""Attendance confirmation, validation, session lifecycle, and duplicate prevention."""
from backend.attendance.service import (
    confirm_attendance_action,
    flag_overdue_open_sessions,
    get_open_session_for_employee,
)

__all__ = [
    "confirm_attendance_action",
    "flag_overdue_open_sessions",
    "get_open_session_for_employee",
]

