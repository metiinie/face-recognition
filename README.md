# Face Recognition-Based Attendance Management System (Version 1 Baseline)
**Ethio-Italy Polytechnic College, Dire Dawa**

A modular, secure, face-recognition-based attendance management system built for individual departmental stations (Version 1), designed so a future continuous-entrance recognition pipeline (Option B) can reuse the exact same `face_engine`, `attendance`, and `database` layers.

---

## 1. Architecture & System Modules

The codebase enforces strict separation of responsibilities across 12 dedicated modules inside `backend/`:

| Module | Path | Responsibility |
| :--- | :--- | :--- |
| **`auth`** | `backend/auth/service.py` | Password hashing, session management, server-side role & permission checks (`@login_required`, `@permission_required`, `@admin_required`). |
| **`employees`** | `backend/employees/service.py` | Employee profiles, unique `employee_number` enforcement (`AT-01`, `AT-02`), department assignments, and soft deactivation preserving historical records (`AT-07`). |
| **`face_engine`** | `backend/face_engine/recognizer.py` | Native computer vision face detection, skin chrominance segmentation (YCbCr locus), anti-spoofing / liveness analysis (texture frequency & chrominance dispersion), and 128-D spatial gradient orientation embedding (`EIPC-Vision-Embedder v1.0`). **Never writes attendance records directly.** |
| **`face_enrollment`** | `backend/face_enrollment/service.py` | Biometric template encryption-at-rest (`Fernet` AES-128-CBC + HMAC-SHA256), model/version tagging (`EIPC-Vision-Embedder v1.0`), template replacement, and revocation. |
| **`stations`** | `backend/stations/service.py` | Departmental station registration, secret-token verification for dedicated devices, and signed device-binding cookies for browser kiosks (`AT-24`). |
| **`security`** | `backend/security/` | Signed station-binding cookies, short-lived recognition tokens, and session-bound CSRF protection for HTML portal forms. |
| **`shifts`** | `backend/shifts/service.py` | Shift templates for `REGULAR_STAFF`, `CLEANING_STAFF`, and `SECURITY_GUARD`, Ethiopian-clock ↔ 24h EAT (`UTC+3`) conversion, overnight shifts (`AT-17`), 24-hour guard shifts (`AT-18`), effective-dated schedule transitions (`AT-19`), and public holiday / approved leave exceptions (`AT-20`). |
| **`attendance`** | `backend/attendance/service.py` | Explicit `CHECK_IN` / `CHECK_OUT` confirmation (`AT-08`, `AT-09`), invalid-action rejection without silent conversion (`AT-10`), duplicate/cooldown protection (`AT-11`, `AT-12`), atomic rollback on failure (`AT-13`), and flagging missing check-outs without inventing timestamps (`AT-14`). |
| **`attendance_review`** | `backend/attendance_review/service.py` | Unknown-face review queue (`review_cases`), documented manual HR attendance (`MANUAL_HR`), and non-destructive attendance corrections preserving original events (`AT-23`). |
| **`reports`** | `backend/reports/service.py` | HR Dashboard KPIs, multi-criteria session/event filtering, and CSV export distinguishing `BIOMETRIC` vs `MANUAL_HR` (`AT-25`). |
| **`audit`** | `backend/audit/service.py` | Append-only audit log (`audit_logs`) for all sensitive operations. |
| **`database`** | `backend/database/` | SQLAlchemy models (`models.py`), atomic transaction context (`__init__.py`), authoritative MySQL 8.x DDL (`mysql_schema.sql`), seed service (`seed.py`), and backup/restore consistency verification (`migrations.py`, `AT-26`). |
| **`web_ui`** | `backend/web_ui/` | Flask HTML routes (`routes.py`), JSON REST API (`api_routes.py`), templates for all 6 screens, and Kiosk WebRTC controller (`kiosk.js`). |

---

## 2. Database Schema & Entity Relationships

Authoritative MySQL 8.x DDL is located in `backend/database/mysql_schema.sql`.

```mermaid
erDiagram
    DEPARTMENTS ||--o{ EMPLOYEES : contains
    DEPARTMENTS ||--o{ ATTENDANCE_STATIONS : assigned_to
    EMPLOYEES ||--o{ FACE_TEMPLATES : enrolled_with
    EMPLOYEES ||--o{ SHIFT_ASSIGNMENTS : assigned
    SHIFT_TEMPLATES ||--o{ SHIFT_ASSIGNMENTS : used_by
    EMPLOYEES ||--o{ ATTENDANCE_SESSIONS : has
    SHIFT_ASSIGNMENTS ||--o{ ATTENDANCE_SESSIONS : scheduled_for
    ATTENDANCE_SESSIONS ||--o{ ATTENDANCE_EVENTS : contains
    ATTENDANCE_STATIONS ||--o{ ATTENDANCE_EVENTS : originates
    USERS ||--o{ AUDIT_LOGS : performs
    USERS ||--o{ ATTENDANCE_CORRECTIONS : authorizes
    ATTENDANCE_SESSIONS ||--o{ ATTENDANCE_CORRECTIONS : concerns
    ATTENDANCE_EVENTS ||--o{ ATTENDANCE_CORRECTIONS : corrects
    USERS ||--o{ REVIEW_CASES : handles
    EMPLOYEES ||--o{ REVIEW_CASES : may_identify
```

---

## 3. Application Screens

1. **Screen 1 — Departmental Attendance Station (`/` or `/station`)**:
   - Full-screen kiosk UI with live camera preview. An administrator first binds the device to a station at **`/station/provision`** (the admin session is signed out afterwards); the page never contains station secrets.
   - Displays the matched employee, department and assigned shift (24h EAT and Ethiopian clock), and requires an explicit **Check-In** or **Check-Out**. The confirmation carries a short-lived, server-signed recognition token bound to that employee and station.
   - When simulation mode is on, extra controls simulate enrolled employees, unknown visitors, poor lighting and obstructed faces.
2. **Screen 2 — Employee Management & Biometric Enrollment (`/employees`)**:
   - Register/edit employees, enforce unique `employee_number`, enroll/replace/revoke encrypted face templates, and soft-deactivate employees while preserving historical attendance.
3. **Screen 3 — HR Dashboard (`/dashboard`)**:
   - Real-time KPIs: today's check-ins/check-outs, on-time vs. late arrivals, open sessions & missing check-outs, and the unrecognized-face review queue.
4. **Screen 4 — Attendance Records & Reports (`/reports`)**:
   - Filter sessions by date range, department, employee, session state, punctuality, and capture method (`BIOMETRIC` vs `MANUAL_HR`), inspect raw immutable events, and export CSV reports.
5. **Screen 5 — Schedule & Station Management (`/schedules-stations`)**:
   - Configure regular, sanitation, overnight, and 24-hour security guard shift templates with Ethiopian-clock display, assign effective-dated schedules, manage holidays/leaves, and register departmental stations.
6. **Screen 6 — Users, Review Queue, Corrections, Audit & Policy Sign-off (`/users-review-audit`)**:
   - Process unknown-face review cases via documented `MANUAL_HR` entries, apply non-destructive attendance corrections with mandatory reasons, manage RBAC users, inspect the append-only audit trail, and track Section 8 Operational Policy Sign-offs.

---

## 4. Quick Start & Tests

```bash
# 1. Create virtual environment and install dependencies
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt

# 2. Run all tests: acceptance (AT-01..AT-26), screen rendering, station security
.venv\Scripts\pytest backend/tests -v

# 3. Start the server (SQLite by default; set DATABASE_URL=mysql+pymysql://user:pass@host/eipc_attendance for MySQL)
.venv\Scripts\python run.py
```

Then sign in as `admin`, open http://localhost:5000/station/provision, and bind the browser to a station.

### Seeded Demo Accounts
- **System Administrator**: `admin` / `Admin@EIPC2026`
- **Senior HR Officer**: `hr_officer` / `Hr@EIPC2026`
- **Internal Auditor**: `auditor` / `Audit@EIPC2026`

### Configuration flags

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `SECRET_KEY` | dev value | Signs sessions, station bindings and recognition tokens. **Must be set in production.** |
| `BIOMETRIC_ENCRYPTION_SECRET` | dev value | Key material for face-template encryption at rest. **Must be set in production.** |
| `DATABASE_URL` | local SQLite | Use a `mysql+pymysql://` URL for the authoritative MySQL database. |
| `ALLOW_SIMULATED_BIOMETRICS` | `1` | Accepts simulated scans and client-supplied quality metrics. **Set to `0` for any deployment with real employees.** |
| `RECOGNITION_TOKEN_MAX_AGE_SECONDS` | `90` | How long an employee has to confirm after a scan. |
| `RECOGNITION_MATCH_THRESHOLD` / `RECOGNITION_UNCERTAIN_THRESHOLD` | `0.78` / `0.62` | Must be re-validated against the real model during the pilot. |

---

## 5. Security & Production Readiness Checklist

1. **Computer Vision & Anti-Spoofing (Implemented & Verified)**: `backend/face_engine/recognizer.py` provides native high-performance skin-locus color segmentation in YCbCr space, anthropometric facial aspect validation, texture frequency & chrominance dispersion anti-spoofing (`liveness_score`), and 128-D spatial gradient orientation descriptors (`EIPC-Vision-Embedder v1.0.0`).
2. **CSRF Protection (Implemented & Verified)**: Session-bound cryptographic CSRF tokens protect all state-changing HTML form actions across all 6 administrative and HR screens.
3. **Database Concurrency & Integrity (Implemented & Verified)**: Open sessions are queried with row-level pessimistic locking (`with_for_update()`) on MySQL, and rapid duplicates or race conditions are safely rejected.
4. **Database Migrations (Implemented & Verified)**: Alembic configuration and baseline migration `001_initial_schema.py` are set up in `migrations/`, alongside the authoritative MySQL 8.x schema in `backend/database/mysql_schema.sql`.
5. **Station Device Trust (Implemented & Verified)**: Kiosk terminals authenticate via signed, HTTP-only device-binding cookies issued through administrator provisioning (`/station/provision`), preventing unauthorized or spoofed station reports.
6. **Policy Sign-Offs**: Section 8 operational policy areas (schedule conversion, biometric privacy and retention, dispute process, station hardware) are initialized and tracked in `policy_signoffs` via Screen 6.
