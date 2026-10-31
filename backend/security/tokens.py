"""
Signed, short-lived tokens that bind kiosk devices and recognition results to the server.

- Station binding cookie: set only when an administrator provisions a device as a station,
  so the station identity comes from trusted configuration, not from the browser (AT-24).
- Recognition token: issued by /api/station/scan and required by /api/station/confirm,
  so a client cannot confirm attendance for an employee the server did not just recognize
  at that same station.
"""
import hashlib
from flask import current_app
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

_STATION_SALT = "eipc-station-binding-v1"
_RECOGNITION_SALT = "eipc-recognition-v1"


def _serializer(salt: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=salt)


def station_token_fingerprint(station_secret_token: str) -> str:
    """Short hash of the station secret; rotating the secret invalidates existing bindings."""
    return hashlib.sha256(station_secret_token.encode("utf-8")).hexdigest()[:16]


def issue_station_binding(station) -> str:
    return _serializer(_STATION_SALT).dumps({
        "sid": station.id,
        "fp": station_token_fingerprint(station.station_secret_token),
    })


def read_station_binding(cookie_value: str | None) -> tuple[int | None, str | None]:
    """Return (station_id, secret_fingerprint), or (None, None) if missing or tampered."""
    if not cookie_value:
        return None, None
    try:
        data = _serializer(_STATION_SALT).loads(cookie_value)
    except BadSignature:
        return None, None
    return data.get("sid"), data.get("fp")


def issue_recognition_token(employee_id: int, station_id: int, score: float) -> str:
    return _serializer(_RECOGNITION_SALT).dumps({"e": employee_id, "s": station_id, "r": score})


def verify_recognition_token(token: str, max_age: int) -> tuple[dict | None, str | None]:
    """Return (payload, None) on success or (None, error_code)."""
    try:
        return _serializer(_RECOGNITION_SALT).loads(token, max_age=max_age), None
    except SignatureExpired:
        return None, "RECOGNITION_TOKEN_EXPIRED"
    except BadSignature:
        return None, "RECOGNITION_TOKEN_INVALID"


def issue_jwt_token(user, expires_in_seconds: int = 86400) -> str:
    """Issue signed JWT bearer token with RBAC role claims."""
    import jwt
    from datetime import datetime, timezone, timedelta

    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role.name if user.role else "USER",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in_seconds)).timestamp()),
    }
    raw_secret = current_app.config.get("SECRET_KEY", "eipc-jwt-secret-key-32-bytes-long-secure-v1")
    secret = hashlib.sha256(raw_secret.encode("utf-8")).digest()
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_jwt_token(token: str) -> tuple[dict | None, str | None]:
    """Verify and decode a JWT bearer token."""
    import jwt
    import hashlib

    raw_secret = current_app.config.get("SECRET_KEY", "eipc-jwt-secret-key-32-bytes-long-secure-v1")
    secret = hashlib.sha256(raw_secret.encode("utf-8")).digest()
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return payload, None
    except jwt.ExpiredSignatureError:
        return None, "TOKEN_EXPIRED"
    except jwt.InvalidTokenError:
        return None, "TOKEN_INVALID"

