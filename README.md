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
| **`face_engine`** | `backend/face_engine/recognizer.py` | Camera frame analysis, brightness/sharpness/obstruction quality checks (`AT-03`, `AT-06`), 128-D embedding extraction, and cosine similarity matching (`AT-04`, `AT-05`). **Never writes attendance records directly.** ⚠️ The embedder is currently a **development placeholder**, not a trained face model — see *Status & remaining work*. |
| **`face_enrollment`** | `backend/face_enrollment/service.py` | Biometric template encryption-at-rest (`Fernet` AES-128-CBC + HMAC-SHA256), model/version tagging (`EIPC-Placeholder-Embedder 0.1.0-dev`, so templates can be re-enrolled when the real model lands), template replacement, and revocation. |
| **`stations`** | `backend/stations/service.py` | Departmental station registration, secret-token verification for dedicated devices, and signed device-binding cookies for browser kiosks (`AT-24`). |
| **`security`** | `backend/security/tokens.py` | Signed station-binding cookies and short-lived recognition tokens linking a scan to its confirmation. |
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

## 5. Status & remaining work before a pilot

> **Not production-ready for real employees yet.** The workflow, schedule, audit and security layers are implemented and tested; the items below are still open.

1. **Real face-recognition model (blocking).** `face_engine` currently uses a placeholder embedder (deterministic signatures for simulation, coarse pixel pooling for camera frames). It cannot tell real faces apart reliably. Recommended replacement: OpenCV YuNet (detection) + SFace (embeddings), which runs on CPU on Windows, behind the existing `recognize_face_candidate` interface. All enrolled templates must then be re-enrolled; the model/version tags support this.
2. **Anti-spoofing / liveness.** Not implemented (Section 8, POL-04 pending).
3. **Alembic migrations.** Tables are currently created with `db.create_all()`; the blueprint calls for versioned migrations.
4. **MySQL verification.** Tests run on SQLite. Run the suite against MySQL 8 and add row locking (`SELECT … FOR UPDATE`) or a unique constraint on open sessions so truly concurrent requests can't race past the duplicate check.
5. **CSRF protection** for the HR portal's HTML forms.
6. **Policy sign-offs** in Section 8 (schedule conversion, biometric privacy and retention, dispute process, station hardware) must be confirmed by college HR.
