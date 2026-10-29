"""
Configuration settings for the Face Recognition-Based Attendance Management System
Ethio-Italy Polytechnic College, Dire Dawa (Version 1)
"""
import os
from datetime import timezone, timedelta

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))

# East Africa Time (UTC+3) - Dire Dawa, Ethiopia
COLLEGE_TIMEZONE_OFFSET = timedelta(hours=3)
COLLEGE_TIMEZONE = timezone(COLLEGE_TIMEZONE_OFFSET, name="EAT (UTC+3)")


class Config:
    """Base configuration."""
    SECRET_KEY = os.environ.get("SECRET_KEY", "eipc-dire-dawa-secret-key-v1-production-change-me")

    # Primary database is MySQL (mysql+pymysql://user:pass@host:3306/eipc_attendance)
    # Falls back to local SQLite file if MYSQL_DATABASE_URI / DATABASE_URL is not configured
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL",
        os.environ.get(
            "MYSQL_DATABASE_URI",
            f"sqlite:///{os.path.join(PROJECT_ROOT, 'eipc_attendance.db')}"
        )
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
    }

    # Biometric template encryption key (32-byte URL-safe base64 key or derived from secret)
    BIOMETRIC_ENCRYPTION_SECRET = os.environ.get(
        "BIOMETRIC_ENCRYPTION_SECRET",
        "eipc-biometric-template-protection-secret-key-2026"
    )

    # Face recognition engine configuration
    FACE_MODEL_NAME = "EIPC-ArcFace-Embedder"
    FACE_MODEL_VERSION = "1.0.0"
    # Cosine similarity threshold (0.0 to 1.0) - validated for pilot
    RECOGNITION_MATCH_THRESHOLD = float(os.environ.get("RECOGNITION_MATCH_THRESHOLD", "0.78"))
    RECOGNITION_UNCERTAIN_THRESHOLD = float(os.environ.get("RECOGNITION_UNCERTAIN_THRESHOLD", "0.62"))

    # Image quality thresholds (AT-03, AT-06)
    MIN_IMAGE_BRIGHTNESS = 45.0       # 0-255 scale
    MAX_IMAGE_BRIGHTNESS = 235.0      # 0-255 scale
    MIN_IMAGE_SHARPNESS = 35.0        # Variance of Laplacian / gradient score

    # Duplicate event / rapid scan cooldown window in seconds (AT-11, AT-12)
    DUPLICATE_EVENT_COOLDOWN_SECONDS = int(os.environ.get("DUPLICATE_EVENT_COOLDOWN_SECONDS", "60"))

    # College metadata
    INSTITUTION_NAME = "Ethio-Italy Polytechnic College, Dire Dawa"
    SYSTEM_VERSION = "1.0.0-baseline"


class TestConfig(Config):
    """Isolated configuration for automated acceptance testing (AT-01 through AT-26)."""
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SECRET_KEY = "test-secret-key"
    DUPLICATE_EVENT_COOLDOWN_SECONDS = 60

