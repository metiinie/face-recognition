@echo off
title EIPC Face Attendance System
echo =========================================================
echo Starting Ethio-Italy Polytechnic College Attendance System
echo =========================================================

echo 1. Starting Backend API (Flask on http://localhost:5000)...
start "EIPC Backend" cmd /k ".venv\Scripts\python run.py"

echo 2. Starting Frontend UI (Next.js on http://localhost:3000)...
cd frontend
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

