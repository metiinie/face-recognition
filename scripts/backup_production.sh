#!/usr/bin/env bash
# ==============================================================================
# Ethio-Italy Polytechnic College (EIPC) — Production Database Backup Runner
# Executes automated point-in-time database snapshot with gzip compression,
# SHA-256 tamper verification, and 30-day retention pruning.
# Suitable for crontab execution:
#   0 2 * * * /opt/eipc/scripts/backup_production.sh >> /var/log/eipc_backup.log 2>&1
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================================================"
echo "[EIPC BACKUP] Starting scheduled database backup at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "========================================================================"

cd "$ROOT_DIR"

# 1. Activate virtual environment if present
if [ -f "$ROOT_DIR/backend/.venv/bin/activate" ]; then
    source "$ROOT_DIR/backend/.venv/bin/activate"
elif [ -f "$ROOT_DIR/.venv/bin/activate" ]; then
    source "$ROOT_DIR/.venv/bin/activate"
fi

# 2. Execute automated snapshot creation
python -m backend.database.backup_service create --label "scheduled_daily"

# 3. Apply 30-day retention pruning (preserves minimum 5 most recent archives)
python -m backend.database.backup_service prune --days 30 --min 5

echo "[EIPC BACKUP] Completed scheduled backup and retention pruning successfully."

