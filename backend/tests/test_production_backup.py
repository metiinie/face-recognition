"""
Acceptance & Integration Test Suite for Production Database Backup Strategy:
  - Automated point-in-time snapshot generation
  - Gzip compression & SHA-256 tamper-evident checksum verification
  - Bit-rot / tampering detection
  - Atomic disaster recovery restoration & relational integrity verification
  - 30-day retention pruning policy & minimum archive preservation
  - Administrative REST API endpoints & audit log verification
"""
import os
import time
import gzip
import pytest
from backend import create_app
from backend.config import TestConfig
from backend.database import db
from backend.database.models import (
    User, Employee, AttendanceSession, AttendanceEvent, AuditLog, FaceTemplate
)
from backend.database.seed import seed_initial_data
from backend.database.backup_service import ProductionBackupManager
from backend.security.tokens import issue_jwt_token


@pytest.fixture()
def app(tmp_path):
    app_config = type("TestBackupConfig", (TestConfig,), {
        "BACKUP_STORAGE_DIR": str(tmp_path / "backups"),
    })
    application = create_app(config_class=app_config, seed_db=False)
    with application.app_context():
        db.create_all()
        seed_initial_data()
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def test_backup_creation_and_checksum_verification(app, tmp_path):
    """Verify that a full consistent backup is created with gzip compression and SHA-256 checksum."""
    b_dir = str(tmp_path / "custom_backups")
    res = ProductionBackupManager.create_backup(backup_dir=b_dir, label="unit_test", actor="backup_admin")

    assert res["status"] == "SUCCESS"
    assert os.path.exists(res["path"])
    assert res["filename"].endswith(".json.gz")
    assert os.path.exists(res["checksum_path"])
    assert len(res["sha256"]) == 64
    assert res["size_bytes"] > 0
    assert res["total_records"] > 0

    # Verify audit log
    audit = AuditLog.query.filter_by(action="DATABASE_BACKUP_CREATED").first()
    assert audit is not None
    assert audit.target_type == "DATABASE"
    assert audit.actor_username == "backup_admin"
    assert audit.details["sha256"] == res["sha256"]


def test_backup_integrity_verification_and_tamper_detection(app, tmp_path):
    """Verify that backup verification passes on pristine archives and detects tampering/corruption."""
    b_dir = str(tmp_path / "tamper_test")
    res = ProductionBackupManager.create_backup(backup_dir=b_dir, label="integrity_check", actor="sys_test")
    archive_path = res["path"]

    # 1. Verification of pristine archive succeeds
    check_pristine = ProductionBackupManager.verify_backup_archive(archive_path)
    assert check_pristine["valid"] is True
    assert len(check_pristine["issues"]) == 0
    assert check_pristine["sha256"] == res["sha256"]

    # 2. Tampering test: modify the companion checksum file
    chk_path = res["checksum_path"]
    with open(chk_path, "w", encoding="utf-8") as f:
        f.write("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  corrupt\n")

    check_tampered_chk = ProductionBackupManager.verify_backup_archive(archive_path)
    assert check_tampered_chk["valid"] is False
    assert any("Checksum mismatch" in iss for iss in check_tampered_chk["issues"])

    # 3. Tampering test: corrupt archive file bytes
    with open(archive_path, "r+b") as f:
        f.seek(10)
        f.write(b"\xff\xff\xff\xff")  # Invalidate gzip payload

    check_corrupt_bytes = ProductionBackupManager.verify_backup_archive(archive_path)
    assert check_corrupt_bytes["valid"] is False


def test_atomic_backup_restoration_and_relational_consistency(app, tmp_path):
    """Verify disaster recovery: restoring from a backup reconstitutes all relations and data."""
    b_dir = str(tmp_path / "restore_test")

    # Initial counts
    orig_sessions_count = AttendanceSession.query.count()
    orig_events_count = AttendanceEvent.query.count()
    orig_employees_count = Employee.query.count()
    assert orig_sessions_count > 0

    # 1. Create baseline backup
    res = ProductionBackupManager.create_backup(backup_dir=b_dir, label="pre_disaster", actor="backup_operator")
    archive_path = res["path"]

    # 2. Simulate disaster: delete sessions and events
    AttendanceSession.query.delete()
    AttendanceEvent.query.delete()
    db.session.commit()

    assert AttendanceSession.query.count() == 0
    assert AttendanceEvent.query.count() == 0

    # 3. Perform disaster recovery restoration
    restore_res = ProductionBackupManager.restore_backup(archive_path, actor="recovery_agent")
    assert restore_res["status"] == "SUCCESS"
    assert restore_res["relational_integrity"]["valid"] is True

    # 4. Verify data is completely reconstituted
    assert AttendanceSession.query.count() == orig_sessions_count
    assert AttendanceEvent.query.count() == orig_events_count
    assert Employee.query.count() == orig_employees_count

    # 5. Verify audit log entry for restoration
    restore_audit = AuditLog.query.filter_by(action="DATABASE_BACKUP_RESTORED").first()
    assert restore_audit is not None
    assert restore_audit.actor_username == "recovery_agent"


def test_retention_policy_pruning(app, tmp_path):
    """Verify automated archive retention policy deletes expired backups while protecting keep_minimum."""
    b_dir = str(tmp_path / "retention_test")
    os.makedirs(b_dir, exist_ok=True)

    # Create 4 dummy backups
    now = time.time()
    for i in range(4):
        p = os.path.join(b_dir, f"eipc_backup_2026010{i+1}_000000_auto.json.gz")
        chk = f"{p}.sha256"
        with gzip.open(p, "wb") as f:
            f.write(b"{}")
        with open(chk, "w") as f:
            f.write("dummy  dummy\n")

        # Age the first 2 files (40 days old)
        if i < 2:
            old_time = now - (40 * 86400)
            os.utime(p, (old_time, old_time))
            os.utime(chk, (old_time, old_time))

    all_initial = ProductionBackupManager.list_backups(backup_dir=b_dir)
    assert len(all_initial) == 4

    # Apply retention policy: delete older than 30 days, keep minimum 2
    prune_res = ProductionBackupManager.apply_retention_policy(
        retention_days=30,
        keep_minimum=2,
        backup_dir=b_dir,
        actor="retention_cron",
    )
    assert prune_res["status"] == "SUCCESS"
    assert prune_res["pruned_count"] == 2
    assert prune_res["remaining_count"] == 2

    # Verify pruned files were actually deleted from disk
    remaining = ProductionBackupManager.list_backups(backup_dir=b_dir)
    assert len(remaining) == 2


def test_api_backup_management_endpoints(client, app, tmp_path):
    """Verify REST API endpoints for backup creation, listing, verification, and pruning."""
    from backend.database.models import User

    # 1. Unauthenticated requests are rejected (401)
    assert client.post("/api/v2/admin/backups/create").status_code == 401
    assert client.get("/api/v2/admin/backups").status_code == 401

    # 2. Non-admin request is rejected (403)
    hr = User.query.filter_by(username="hr_officer").first()
    hr_token = issue_jwt_token(hr)
    assert client.post("/api/v2/admin/backups/create", headers={"Authorization": f"Bearer {hr_token}"}).status_code == 403

    # 3. Admin user creates a backup (200 OK)
    admin = User.query.filter_by(username="admin").first()
    admin_token = issue_jwt_token(admin)
    auth_hdr = {"Authorization": f"Bearer {admin_token}"}

    create_resp = client.post("/api/v2/admin/backups/create", headers=auth_hdr, json={"label": "api_test"})
    assert create_resp.status_code == 200
    create_data = create_resp.get_json()
    assert create_data["status"] == "SUCCESS"
    filename = create_data["filename"]

    # 4. Admin lists backups
    list_resp = client.get("/api/v2/admin/backups", headers=auth_hdr)
    assert list_resp.status_code == 200
    list_data = list_resp.get_json()
    assert list_data["count"] >= 1
    assert any(b["filename"] == filename for b in list_data["backups"])

    # 5. Admin verifies backup
    verify_resp = client.post("/api/v2/admin/backups/verify", headers=auth_hdr, json={"filename": filename})
    assert verify_resp.status_code == 200
    assert verify_resp.get_json()["valid"] is True

    # 6. Admin prunes backups
    prune_resp = client.post("/api/v2/admin/backups/prune", headers=auth_hdr, json={"retention_days": 30, "keep_minimum": 1})
    assert prune_resp.status_code == 200
    assert prune_resp.get_json()["status"] == "SUCCESS"

