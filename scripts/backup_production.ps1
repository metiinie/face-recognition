# ==============================================================================
# Ethio-Italy Polytechnic College (EIPC) — Production Database Backup Runner (Windows)
# Executes automated point-in-time database snapshot with gzip compression,
# SHA-256 tamper verification, and 30-day retention pruning.
# ==============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

Write-Host "========================================================================"
Write-Host "[EIPC BACKUP] Starting scheduled database backup at $(Get-Date -Format 'o')"
Write-Host "========================================================================"

Set-Location $RootDir

$PythonPath = Join-Path $RootDir "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $PythonPath)) {
    $PythonPath = "python"
}

# 1. Execute automated snapshot creation
& $PythonPath -m backend.database.backup_service create --label "scheduled_daily"

# 2. Apply 30-day retention pruning
& $PythonPath -m backend.database.backup_service prune --days 30 --min 5

Write-Host "[EIPC BACKUP] Completed scheduled backup and retention pruning successfully."

