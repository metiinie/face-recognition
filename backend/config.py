"""
Configuration settings for the Face Recognition-Based Attendance Management System
Ethio-Italy Polytechnic College, Dire Dawa (Version 1)
"""
import os
from datetime import timezone, timedelta

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
PROJECT_ROOT = BASE_DIR

# East Africa Time (UTC+3) - Dire Dawa, Ethiopia
COLLEGE_TIMEZONE_OFFSET = timedelta(hours=3)
COLLEGE_TIMEZONE = timezone(COLLEGE_TIMEZONE_OFFSET, name="EAT (UTC+3)")


INSECURE_DEFAULT_SECRET = "eipc-dire-dawa-secret-key-v1-production-change-me"
INSECURE_DEFAULT_BIOMETRIC = "eipc-biometric-template-protection-secret-key-2026"


def _normalize_database_uri(uri: str) -> str:
    """Ensure database connection URIs containing unencoded characters like '@' in passwords are safely parsed."""
    if not uri or not uri.startswith("mysql"):
        return uri
    try:
        from sqlalchemy.engine import make_url
        url = make_url(uri)
        if url.host and "@" in url.host:
            scheme, rest = uri.split("://", 1)
            last_at_idx = rest.rfind("@")
            userinfo = rest[:last_at_idx]
            host_db = rest[last_at_idx + 1:]
            if ":" in userinfo:
                username, password = userinfo.split(":", 1)
                import urllib.parse
                safe_pass = urllib.parse.quote_plus(password)
                return f"{scheme}://{username}:{safe_pass}@{host_db}"
    except Exception:
        pass
    return uri


class Config:
    """Base configuration."""
    SECRET_KEY = os.environ.get("SECRET_KEY", INSECURE_DEFAULT_SECRET)

    # Primary database is MySQL (mysql+pymysql://user:pass@host:3306/eipc_attendance)
    # Falls back to local SQLite file if MYSQL_DATABASE_URI / DATABASE_URL is not configured
    SQLALCHEMY_DATABASE_URI = _normalize_database_uri(
        os.environ.get(
            "DATABASE_URL",
            os.environ.get(
                "MYSQL_DATABASE_URI",
                f"sqlite:///{os.path.join(PROJECT_ROOT, 'eipc_attendance.db')}"
            )
        )
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
    }

    # Biometric template encryption key (32-byte URL-safe base64 key or derived from secret)
    BIOMETRIC_ENCRYPTION_SECRET = os.environ.get(
        "BIOMETRIC_ENCRYPTION_SECRET",
        INSECURE_DEFAULT_BIOMETRIC
    )

    # Face recognition engine configuration.
    # Native computer vision embedder with YCbCr skin locus segmentation,
    # multi-scale spatial gradient orientation descriptors and liveness / anti-spoofing analysis.
    FACE_MODEL_NAME = "EIPC-Vision-Embedder"
    FACE_MODEL_VERSION = "1.0.0"

    # Simulation mode accepts named biometric signatures, raw embedding vectors and
    # client-supplied quality metrics. It exists only for demos and automated tests and
    # MUST be disabled (ALLOW_SIMULATED_BIOMETRICS=0) for any deployment with real employees.
    ALLOW_SIMULATED_BIOMETRICS = os.environ.get("ALLOW_SIMULATED_BIOMETRICS", "1") == "1"

    # Kiosks may not choose their own event timestamps; the server clock is authoritative.
    ALLOW_CLIENT_EVENT_TIMESTAMPS = False

    # A recognition result must be confirmed within this window or the employee rescans.
    RECOGNITION_TOKEN_MAX_AGE_SECONDS = int(os.environ.get("RECOGNITION_TOKEN_MAX_AGE_SECONDS", "90"))

    # Signed cookie that binds a provisioned browser/device to one attendance station.
    STATION_COOKIE_NAME = "eipc_station"
    # Cosine similarity threshold (0.0 to 1.0) - calibrated for live optical camera embeddings (OpenCV SFace standard: 0.363)
    RECOGNITION_MATCH_THRESHOLD = float(os.environ.get("RECOGNITION_MATCH_THRESHOLD", "0.35"))
    RECOGNITION_UNCERTAIN_THRESHOLD = float(os.environ.get("RECOGNITION_UNCERTAIN_THRESHOLD", "0.25"))

    # Image quality thresholds (AT-03, AT-06)
    MIN_IMAGE_BRIGHTNESS = 45.0       # 0-255 scale
    MAX_IMAGE_BRIGHTNESS = 235.0      # 0-255 scale
    MIN_IMAGE_SHARPNESS = float(os.environ.get("MIN_IMAGE_SHARPNESS", "25.0"))        # Variance of Laplacian / gradient score

    # Duplicate event / rapid scan cooldown window in seconds (AT-11, AT-12)
    DUPLICATE_EVENT_COOLDOWN_SECONDS = int(os.environ.get("DUPLICATE_EVENT_COOLDOWN_SECONDS", "60"))

    # College metadata
    INSTITUTION_NAME = "Ethio-Italy Polytechnic College, Dire Dawa"
    SYSTEM_VERSION = "1.0.0-baseline"

    # Shared message queue for multi-instance / multi-worker WebSocket scalability (Redis pub-sub)
    REDIS_URL = os.environ.get("REDIS_URL", None)
    SOCKETIO_MESSAGE_QUEUE = os.environ.get("SOCKETIO_MESSAGE_QUEUE", REDIS_URL)


class TestConfig(Config):
    """Isolated configuration for automated acceptance testing (AT-01 through AT-26)."""
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SECRET_KEY = "test-secret-key"
    DUPLICATE_EVENT_COOLDOWN_SECONDS = 60
    ALLOW_SIMULATED_BIOMETRICS = True
    # Tests replay events at fixed historical times (shift, overnight and 24h scenarios).
    ALLOW_CLIENT_EVENT_TIMESTAMPS = True
    SOCKETIO_MESSAGE_QUEUE = None


class ProductionConfig(Config):
    """Production configuration with strict security validations."""
    ENV = "production"
    ALLOW_SIMULATED_BIOMETRICS = False


def validate_production_secrets(config_dict_or_obj):
    """Strictly assert that production deployments do not run with insecure fallback secrets."""
    secret_key = (
        config_dict_or_obj.get("SECRET_KEY")
        if isinstance(config_dict_or_obj, dict)
        else getattr(config_dict_or_obj, "SECRET_KEY", None)
    )
    bio_secret = (
        config_dict_or_obj.get("BIOMETRIC_ENCRYPTION_SECRET")
        if isinstance(config_dict_or_obj, dict)
        else getattr(config_dict_or_obj, "BIOMETRIC_ENCRYPTION_SECRET", None)
    )

    if not secret_key or secret_key == INSECURE_DEFAULT_SECRET or len(str(secret_key)) < 32:
        raise RuntimeError(
            "CRITICAL SECURITY ERROR: Insecure or missing SECRET_KEY in production! "
            "You must configure a unique, cryptographically strong SECRET_KEY (min 32 characters) via environment variable."
        )

    if not bio_secret or bio_secret == INSECURE_DEFAULT_BIOMETRIC or len(str(bio_secret)) < 32:
        raise RuntimeError(
            "CRITICAL SECURITY ERROR: Insecure or missing BIOMETRIC_ENCRYPTION_SECRET in production! "
            "You must configure a unique BIOMETRIC_ENCRYPTION_SECRET (min 32 characters) via environment variable."
        )


