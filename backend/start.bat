@echo off
title EIPC Face Attendance System
echo =========================================================
echo Starting Ethio-Italy Polytechnic College Attendance System
echo =========================================================

set "BACKEND_DIR=%~dp0"
set "ROOT_DIR=%BACKEND_DIR%.."
set "FRONTEND_DIR=%ROOT_DIR%\frontend"

echo 1. Starting Backend API (Flask on http://localhost:5000)...
cd /d "%BACKEND_DIR%"
start "EIPC Backend" cmd /k ".venv\Scripts\python run.py"

echo 2. Starting Frontend UI (Next.js on http://localhost:3000)...
cd /d "%FRONTEND_DIR%"
start "EIPC Frontend" cmd /k "npm run dev"

echo.
echo =========================================================
echo Both services are launching!
echo Frontend Kiosk:    http://localhost:3000/kiosk
echo Staff Directory:   http://localhost:3000/employees
echo HR Dashboard:      http://localhost:3000/dashboard
echo Biometrics Lab:    http://localhost:3000/biometrics
echo Backend API:       http://localhost:5000
echo =========================================================
