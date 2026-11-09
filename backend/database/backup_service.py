"""
Production Database Backup, Disaster Recovery, and Retention Service.
Provides automated point-in-time snapshots, gzip compression, SHA-256 tamper verification,
retention pruning, and atomic restoration with relational integrity checks.
Satisfies Section 5 (Database Migrations & Disaster Recovery) and AT-26.
"""
import argparse
import gzip
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone, timedelta
from flask import current_app, has_app_context

from backend.database import db
from backend.database.migrations import (
    export_full_backup_snapshot,
    restore_backup_snapshot,
    verify_relational_integrity,
)
from backend.audit.service import record_audit_log
from backend.database.models import utc_now

logger = logging.getLogger(__name__)


class ProductionBackupManager:
    """
    Authoritative manager for database backups, disaster recovery,
    tamper-evident verification, and automated archive retention.
    """

    @classmethod
    def get_backup_dir(cls, custom_dir: str | None = None) -> str:
        """Resolve and ensure the target backup directory exists."""
        if custom_dir:
            b_dir = os.path.abspath(custom_dir)
        elif has_app_context() and current_app.config.get("BACKUP_STORAGE_DIR"):
            b_dir = os.path.abspath(current_app.config["BACKUP_STORAGE_DIR"])
        else:
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            b_dir = os.path.join(base_dir, "backups")
        os.makedirs(b_dir, exist_ok=True)
        return b_dir

    @classmethod
    def create_backup(
        cls,
        backup_dir: str | None = None,
        label: str | None = None,
        actor: str = "SYSTEM",
    ) -> dict:
        """
        Create a consistent, compressed, SHA-256 checksummed database backup snapshot.
        Atomically packages all authoritative tables, writes to disk, logs an audit entry.
        """
        target_dir = cls.get_backup_dir(backup_dir)
        now = utc_now()
        timestamp_str = now.strftime("%Y%m%d_%H%M%S")
        clean_label = "".join(c for c in (label or "auto") if c.isalnum() or c in ("-", "_")).lower()
        filename = f"eipc_backup_{timestamp_str}_{clean_label}.json.gz"
        archive_path = os.path.join(target_dir, filename)
        checksum_path = f"{archive_path}.sha256"

        # 1. Export complete relational snapshot across all 15 authoritative tables
        snapshot = export_full_backup_snapshot()
        table_counts = {k: len(v) for k, v in snapshot.get("tables", {}).items()}

        dialect_name = "sqlite"
        try:
            dialect_name = db.engine.dialect.name
        except Exception:
            pass

        backup_envelope = {
            "backup_id": f"BCK-{int(time.time())}-{timestamp_str}",
            "schema_version": snapshot.get("schema_version", "1.0.0-eipc-v1"),
            "created_at": now.isoformat(),
            "database_engine": dialect_name,
            "created_by": actor,
            "table_counts": table_counts,
            "total_records": sum(table_counts.values()),
            "snapshot": snapshot,
        }

        # 2. Serialize JSON and compress with gzip level 9
        json_bytes = json.dumps(backup_envelope, indent=None).encode("utf-8")
        compressed_bytes = gzip.compress(json_bytes, compresslevel=9)

        with open(archive_path, "wb") as f:
            f.write(compressed_bytes)

        # 3. Compute SHA-256 tamper-evident checksum
        sha256_hash = hashlib.sha256(compressed_bytes).hexdigest()
        with open(checksum_path, "w", encoding="utf-8") as f:
            f.write(f"{sha256_hash}  {filename}\n")

        file_size_bytes = len(compressed_bytes)
        file_size_kb = round(file_size_bytes / 1024.0, 2)

        # 4. Immutable audit logging
        try:
            record_audit_log(
                action="DATABASE_BACKUP_CREATED",
                target_type="DATABASE",
                target_id=filename,
                reason=f"Full database backup archive generated ({file_size_kb} KB, {sum(table_counts.values())} records).",
                details={
                    "filename": filename,
                    "sha256": sha256_hash,
                    "file_size_bytes": file_size_bytes,
                    "table_counts": table_counts,
                    "actor": actor,
                },
                actor_username=actor,
            )
        except Exception as e:
            logger.warning(f"Could not write audit log for backup creation: {e}")

        logger.info(f"Database backup created: {archive_path} ({file_size_kb} KB, SHA-256: {sha256_hash[:12]}...)")

        return {
            "status": "SUCCESS",
            "filename": filename,
            "path": archive_path,
            "checksum_path": checksum_path,
            "sha256": sha256_hash,
            "size_bytes": file_size_bytes,
            "size_kb": file_size_kb,
            "table_counts": table_counts,
            "total_records": sum(table_counts.values()),
            "created_at": now.isoformat(),
        }

    @classmethod
    def list_backups(cls, backup_dir: str | None = None) -> list[dict]:
        """List all available backup archives with metadata and integrity status."""
        target_dir = cls.get_backup_dir(backup_dir)
        if not os.path.exists(target_dir):
            return []

        archives = []
        for fn in os.listdir(target_dir):
            if fn.endswith(".json.gz"):
                full_path = os.path.join(target_dir, fn)
                chk_path = f"{full_path}.sha256"
                mtime = os.path.getmtime(full_path)
                size_bytes = os.path.getsize(full_path)

                has_chk = os.path.exists(chk_path)
                saved_chk = None
                if has_chk:
                    try:
                        with open(chk_path, "r", encoding="utf-8") as f:
                            saved_chk = f.read().split()[0].strip()
                    except Exception:
                        pass

                archives.append({
                    "filename": fn,
                    "path": full_path,
                    "size_bytes": size_bytes,
                    "size_kb": round(size_bytes / 1024.0, 2),
                    "created_at": datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat(),
                    "mtime": mtime,
                    "has_checksum": has_chk,
                    "sha256": saved_chk,
                })

        archives.sort(key=lambda x: x["mtime"], reverse=True)
        return archives

    @classmethod
    def verify_backup_archive(cls, archive_path: str, actor: str = "SYSTEM") -> dict:
        """
        Verify the physical and cryptographic integrity of a backup archive.
        Validates SHA-256 checksum, gzip decompression, JSON structure, and required schema tables.
        """
        if not os.path.exists(archive_path):
            return {"valid": False, "error": f"Backup file not found at: {archive_path}"}

        issues = []
        filename = os.path.basename(archive_path)

        # 1. Check SHA-256 checksum
        chk_path = f"{archive_path}.sha256"
        with open(archive_path, "rb") as f:
            raw_bytes = f.read()

        computed_sha256 = hashlib.sha256(raw_bytes).hexdigest()

        if os.path.exists(chk_path):
            try:
                with open(chk_path, "r", encoding="utf-8") as f:
                    expected_sha256 = f.read().split()[0].strip()
                if computed_sha256.lower() != expected_sha256.lower():
                    issues.append(
                        f"Checksum mismatch: expected {expected_sha256[:12]}..., computed {computed_sha256[:12]}..."
                    )
            except Exception as ex:
                issues.append(f"Failed to read companion checksum file: {ex}")
        else:
            issues.append("Companion .sha256 checksum file is missing.")

        # 2. Verify gzip decompression
        try:
            decompressed = gzip.decompress(raw_bytes)
        except Exception as ex:
            return {"valid": False, "error": f"Gzip archive is corrupted or unreadable: {ex}", "issues": issues}

        # 3. Verify JSON envelope and table completeness
        try:
            envelope = json.loads(decompressed.decode("utf-8"))
        except Exception as ex:
            return {"valid": False, "error": f"JSON payload inside archive is invalid: {ex}", "issues": issues}

        snapshot = envelope.get("snapshot", {})
        tables = snapshot.get("tables", {})

        required_tables = [
            "employees",
            "attendance_sessions",
            "attendance_events",
            "face_templates",
            "audit_logs",
            "shift_templates",
        ]
        for tbl in required_tables:
            if tbl not in tables:
                issues.append(f"Critical authoritative table '{tbl}' is missing from snapshot.")

        valid = len(issues) == 0

        # Audit log verification attempt
        try:
            record_audit_log(
                action="DATABASE_BACKUP_VERIFIED",
                target_type="DATABASE",
                target_id=filename,
                reason=f"Integrity check {'PASSED' if valid else 'FAILED'} for backup {filename}.",
                details={
                    "filename": filename,
                    "valid": valid,
                    "issues": issues,
                    "table_counts": envelope.get("table_counts", {}),
                    "actor": actor,
                },
                actor_username=actor,
            )
        except Exception:
            pass

        return {
            "valid": valid,
            "filename": filename,
            "issues": issues,
            "backup_id": envelope.get("backup_id"),
            "schema_version": envelope.get("schema_version"),
            "created_at": envelope.get("created_at"),
            "database_engine": envelope.get("database_engine"),
            "table_counts": envelope.get("table_counts", {}),
            "total_records": envelope.get("total_records", 0),
            "sha256": computed_sha256,
        }

    @classmethod
    def restore_backup(cls, archive_path: str, actor: str = "SYSTEM") -> dict:
        """
        Restore database state from a validated backup archive.
        Enforces integrity verification before restoration and checks relational consistency after.
        """
        # Pre-flight verification
        verify_res = cls.verify_backup_archive(archive_path, actor=actor)
        if not verify_res.get("valid"):
            err_msg = "; ".join(verify_res.get("issues", [])) or verify_res.get("error", "Integrity check failed")
            raise ValueError(f"Cannot restore corrupt or unverified backup: {err_msg}")

        with open(archive_path, "rb") as f:
            raw_bytes = f.read()

        decompressed = gzip.decompress(raw_bytes)
        envelope = json.loads(decompressed.decode("utf-8"))
        snapshot = envelope.get("snapshot", {})

        # Restore snapshot through transactional relational reconstructor
        integrity_report = restore_backup_snapshot(snapshot)

        # Invalidate in-memory vector cache so recognition matches the restored templates
        try:
            from backend.face_engine.recognizer import invalidate_template_cache
            invalidate_template_cache()
        except Exception:
            pass

        filename = os.path.basename(archive_path)
        try:
            record_audit_log(
                action="DATABASE_BACKUP_RESTORED",
                target_type="DATABASE",
                target_id=filename,
                reason=f"Restored full database backup {filename} with relational verification: {integrity_report.get('valid')}.",
                details={
                    "filename": filename,
                    "restored_records": envelope.get("total_records", 0),
                    "integrity_valid": integrity_report.get("valid", False),
                    "actor": actor,
                },
                actor_username=actor,
            )
        except Exception as e:
            logger.warning(f"Could not write audit log for restore: {e}")

        return {
            "status": "SUCCESS",
            "filename": filename,
            "restored_at": utc_now().isoformat(),
            "restored_records": envelope.get("total_records", 0),
            "relational_integrity": integrity_report,
        }

    @classmethod
    def apply_retention_policy(
        cls,
        retention_days: int = 30,
        keep_minimum: int = 5,
        backup_dir: str | None = None,
        actor: str = "SYSTEM",
    ) -> dict:
        """
        Automated retention pruning: deletes archives older than retention_days,
        guaranteeing that at least keep_minimum recent backups are preserved.
        """
        backups = cls.list_backups(backup_dir)
        if len(backups) <= keep_minimum:
            return {
                "status": "SUCCESS",
                "pruned_count": 0,
                "remaining_count": len(backups),
                "message": f"Backup count ({len(backups)}) is within keep_minimum ({keep_minimum}). No files pruned.",
            }

        cutoff_time = time.time() - (retention_days * 86400)
        candidates = backups[keep_minimum:]  # Protect the keep_minimum newest archives

        pruned_files = []
        for b in candidates:
            if b["mtime"] < cutoff_time:
                try:
                    os.remove(b["path"])
                    pruned_files.append(b["filename"])
                    chk_path = f"{b['path']}.sha256"
                    if os.path.exists(chk_path):
                        os.remove(chk_path)
                except Exception as ex:
                    logger.warning(f"Failed to prune backup file {b['filename']}: {ex}")

        if pruned_files:
            try:
                record_audit_log(
                    action="DATABASE_BACKUPS_PRUNED",
                    target_type="DATABASE",
                    target_id="RETENTION_POLICY",
                    reason=f"Pruned {len(pruned_files)} expired backup archives older than {retention_days} days.",
                    details={
                        "pruned_count": len(pruned_files),
                        "pruned_files": pruned_files,
                        "retention_days": retention_days,
                        "keep_minimum": keep_minimum,
                        "actor": actor,
                    },
                    actor_username=actor,
                )
            except Exception:
                pass

        remaining = cls.list_backups(backup_dir)
        return {
            "status": "SUCCESS",
            "pruned_count": len(pruned_files),
            "remaining_count": len(remaining),
            "pruned_files": pruned_files,
        }


# ---------------------------------------------------------------------------
# CLI Command Runner
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    from backend import create_app
    from backend.config import Config

    parser = argparse.ArgumentParser(description="EIPC Production Database Backup & Recovery Utility")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcommand: create
    create_p = subparsers.add_parser("create", help="Generate a new full database backup archive")
    create_p.add_argument("--label", type=str, default="manual", help="Backup filename label (default: manual)")
    create_p.add_argument("--dir", type=str, default=None, help="Custom output directory")

    # Subcommand: list
    list_p = subparsers.add_parser("list", help="List existing database backups and checksums")
    list_p.add_argument("--dir", type=str, default=None, help="Custom backup directory")

    # Subcommand: verify
    verify_p = subparsers.add_parser("verify", help="Verify the integrity of a backup archive")
    verify_p.add_argument("path", type=str, help="Path to .json.gz archive file")

    # Subcommand: restore
    restore_p = subparsers.add_parser("restore", help="Restore database from a backup archive")
    restore_p.add_argument("path", type=str, help="Path to .json.gz archive file")

    # Subcommand: prune
    prune_p = subparsers.add_parser("prune", help="Prune expired backups according to retention policy")
    prune_p.add_argument("--days", type=int, default=30, help="Retention period in days (default: 30)")
    prune_p.add_argument("--min", type=int, default=5, help="Minimum backups to preserve (default: 5)")
    prune_p.add_argument("--dir", type=str, default=None, help="Custom backup directory")

    args = parser.parse_args()

    app = create_app(config_class=Config, seed_db=False)
    with app.app_context():
        if args.command == "create":
            res = ProductionBackupManager.create_backup(backup_dir=args.dir, label=args.label, actor="CLI")
            print(json.dumps(res, indent=2))
        elif args.command == "list":
            backups = ProductionBackupManager.list_backups(backup_dir=args.dir)
            print(f"\nFound {len(backups)} backup archive(s):\n")
            print(f"{'Filename':<42} {'Size':>10} {'Created At':<26} {'SHA-256':<14}")
            print("-" * 96)
            for b in backups:
                sha_disp = (b['sha256'] or 'MISSING')[:12] + '...' if b['sha256'] else 'MISSING'
                print(f"{b['filename']:<42} {b['size_kb']:>7.1f} KB {b['created_at']:<26} {sha_disp:<14}")
            print()
        elif args.command == "verify":
            res = ProductionBackupManager.verify_backup_archive(args.path, actor="CLI")
            print(json.dumps(res, indent=2))
        elif args.command == "restore":
            res = ProductionBackupManager.restore_backup(args.path, actor="CLI")
            print(json.dumps(res, indent=2))
        elif args.command == "prune":
            res = ProductionBackupManager.apply_retention_policy(
                retention_days=args.days, keep_minimum=args.min, backup_dir=args.dir, actor="CLI"
            )
            print(json.dumps(res, indent=2))

