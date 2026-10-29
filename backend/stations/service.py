"""
Attendance station registration, department assignment, and trusted station verification.
Satisfies Section 1 (Department stations), Section 5 (trusted station configuration), and AT-24.
"""
import hmac
import secrets
from backend.database import db, transactional_session
from backend.database.models import AttendanceStation, Department, utc_now
from backend.audit.service import record_audit_log


def register_station(
    station_code: str,
    name: str,
    department_id: int,
    location: str,
    station_secret_token: str | None = None,
    actor: str = "Admin",
) -> tuple[AttendanceStation | None, str | None]:
    if not station_code or not name or not location:
        return None, "Station code, name, and location are required."

    code_clean = station_code.strip().upper()
    if AttendanceStation.query.filter_by(station_code=code_clean).first():
        return None, f"Station code '{code_clean}' is already registered."

    dept = db.session.get(Department, department_id)
    if not dept:
        return None, "Department not found."

    token = station_secret_token or f"st-tok-{code_clean.lower()}-{secrets.token_hex(8)}"

    with transactional_session() as session:
        station = AttendanceStation(
            station_code=code_clean,
            name=name.strip(),
            department_id=dept.id,
            location=location.strip(),
            station_secret_token=token,
            status="ACTIVE",
            camera_status="ONLINE",
            created_at=utc_now(),
        )
        session.add(station)
        session.flush()

        record_audit_log(
            action="STATION_REGISTERED",
            target_type="STATION",
            target_id=station.station_code,
            details={"department": dept.code, "location": station.location},
            actor_username=actor,
        )

    return station, None


def verify_trusted_station(
    station_code_or_id: str | int | None,
    provided_token: str | None,
) -> tuple[AttendanceStation | None, str | None]:
    """
    Validate that the attendance station exists, is ACTIVE, and presents its trusted
    configuration token. Prevents an untrusted browser request from spoofing or
    impersonating another station ID (AT-24).
    """
    if station_code_or_id is None:
        return None, "Station identifier is missing."

    station = None
    if isinstance(station_code_or_id, int) or str(station_code_or_id).isdigit():
        station = db.session.get(AttendanceStation, int(station_code_or_id))
    if not station:
        station = AttendanceStation.query.filter_by(
            station_code=str(station_code_or_id).strip().upper()
        ).first()

    if not station:
        record_audit_log(
            action="STATION_IMPERSONATION_OR_UNKNOWN",
            target_type="STATION",
            target_id=str(station_code_or_id),
            reason="Unknown station identifier presented",
            commit=True,
        )
        return None, "Unrecognized attendance station."

    if station.status != "ACTIVE":
        return None, f"Attendance station '{station.station_code}' is currently {station.status}."

    if not provided_token or not hmac.compare_digest(
        station.station_secret_token.encode("utf-8"),
        str(provided_token).strip().encode("utf-8"),
    ):
        record_audit_log(
            action="STATION_AUTH_REJECTED",
            target_type="STATION",
            target_id=station.station_code,
            reason="Invalid or missing trusted station secret token (AT-24)",
            station_id=station.id,
            commit=True,
        )
        return None, "Station authentication failed: invalid or missing trusted station token."

    return station, None

