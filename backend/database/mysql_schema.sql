-- =============================================================================
-- Face Recognition-Based Attendance Management System (Version 1)
-- Ethio-Italy Polytechnic College, Dire Dawa
-- Authoritative MySQL 8.x Schema DDL
-- =============================================================================

CREATE DATABASE IF NOT EXISTS eipc_attendance
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE eipc_attendance;

CREATE TABLE IF NOT EXISTS roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255) NULL,
    permissions_csv TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(120) NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME NULL,
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    code VARCHAR(30) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_number VARCHAR(40) NOT NULL UNIQUE,
    first_name VARCHAR(80) NOT NULL,
    last_name VARCHAR(80) NOT NULL,
    department_id INT NOT NULL,
    job_category VARCHAR(40) NOT NULL DEFAULT 'REGULAR_STAFF',
    phone VARCHAR(40) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    consent_verified TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_employees_department FOREIGN KEY (department_id) REFERENCES departments(id),
    INDEX idx_employees_dept_status (department_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS face_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    template_data TEXT NOT NULL,
    model_name VARCHAR(80) NOT NULL DEFAULT 'EIPC-ArcFace-Embedder',
    model_version VARCHAR(40) NOT NULL DEFAULT '1.0.0',
    quality_score DOUBLE NOT NULL DEFAULT 0.95,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    enrolled_by VARCHAR(80) NULL,
    enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME NULL,
    revoke_reason VARCHAR(255) NULL,
    CONSTRAINT fk_face_templates_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    INDEX idx_face_templates_emp_status (employee_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_stations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    station_code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    department_id INT NOT NULL,
    location VARCHAR(160) NOT NULL,
    station_secret_token VARCHAR(128) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    camera_status VARCHAR(30) NOT NULL DEFAULT 'ONLINE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_stations_department FOREIGN KEY (department_id) REFERENCES departments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shift_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    job_category VARCHAR(40) NOT NULL DEFAULT 'REGULAR_STAFF',
    start_time VARCHAR(5) NOT NULL,
    end_time VARCHAR(5) NOT NULL,
    spans_midnight TINYINT(1) NOT NULL DEFAULT 0,
    is_24_hour TINYINT(1) NOT NULL DEFAULT 0,
    break_rules VARCHAR(255) NULL,
    grace_period_minutes INT NOT NULL DEFAULT 15,
    early_checkin_window_minutes INT NOT NULL DEFAULT 90,
    hr_approved TINYINT(1) NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shift_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    shift_template_id INT NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    working_days VARCHAR(40) NOT NULL DEFAULT '0,1,2,3,4',
    approved_by VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_shift_assign_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
    CONSTRAINT fk_shift_assign_template FOREIGN KEY (shift_template_id) REFERENCES shift_templates(id),
    INDEX idx_shift_assign_emp_dates (employee_id, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schedule_exceptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(120) NOT NULL,
    exception_type VARCHAR(30) NOT NULL DEFAULT 'PUBLIC_HOLIDAY',
    employee_id INT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason VARCHAR(255) NULL,
    approved_by VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_exception_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    shift_assignment_id INT NULL,
    work_date DATE NOT NULL,
    shift_start_at DATETIME NOT NULL,
    shift_end_at DATETIME NOT NULL,
    check_in_event_id INT NULL,
    check_out_event_id INT NULL,
    arrival_status VARCHAR(20) NOT NULL DEFAULT 'ON_TIME',
    late_minutes INT NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    is_corrected TINYINT(1) NOT NULL DEFAULT 0,
    notes VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_sessions_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
    CONSTRAINT fk_sessions_shift_assign FOREIGN KEY (shift_assignment_id) REFERENCES shift_assignments(id),
    INDEX idx_sessions_emp_status (employee_id, status),
    INDEX idx_sessions_work_date (work_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NULL,
    employee_id INT NOT NULL,
    event_type VARCHAR(20) NOT NULL,
    occurred_at DATETIME NOT NULL,
    station_id INT NULL,
    capture_method VARCHAR(20) NOT NULL DEFAULT 'BIOMETRIC',
    recognition_score DOUBLE NULL,
    recorded_by_user_id INT NULL,
    manual_reason VARCHAR(255) NULL,
    evidence_ref VARCHAR(120) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_events_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id),
    CONSTRAINT fk_events_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
    CONSTRAINT fk_events_station FOREIGN KEY (station_id) REFERENCES attendance_stations(id),
    CONSTRAINT fk_events_recorded_by FOREIGN KEY (recorded_by_user_id) REFERENCES users(id),
    INDEX idx_events_emp_occurred (employee_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS review_cases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    station_id INT NULL,
    candidate_employee_id INT NULL,
    claimed_employee_number VARCHAR(40) NULL,
    case_type VARCHAR(40) NOT NULL DEFAULT 'UNKNOWN_FACE',
    intended_action VARCHAR(20) NULL,
    reason TEXT NOT NULL,
    recognition_score DOUBLE NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    resolution_notes TEXT NULL,
    evidence_reference VARCHAR(120) NULL,
    resolved_by_user_id INT NULL,
    resolved_event_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    CONSTRAINT fk_review_station FOREIGN KEY (station_id) REFERENCES attendance_stations(id),
    CONSTRAINT fk_review_candidate FOREIGN KEY (candidate_employee_id) REFERENCES employees(id),
    CONSTRAINT fk_review_resolved_by FOREIGN KEY (resolved_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_review_resolved_event FOREIGN KEY (resolved_event_id) REFERENCES attendance_events(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_corrections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    original_event_id INT NULL,
    replacement_event_id INT NULL,
    correction_type VARCHAR(40) NOT NULL,
    previous_timestamp DATETIME NULL,
    corrected_timestamp DATETIME NOT NULL,
    reason TEXT NOT NULL,
    evidence_ref VARCHAR(120) NULL,
    corrected_by_user_id INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_correction_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id),
    CONSTRAINT fk_correction_orig_event FOREIGN KEY (original_event_id) REFERENCES attendance_events(id),
    CONSTRAINT fk_correction_repl_event FOREIGN KEY (replacement_event_id) REFERENCES attendance_events(id),
    CONSTRAINT fk_correction_user FOREIGN KEY (corrected_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    actor_user_id INT NULL,
    actor_username VARCHAR(80) NOT NULL DEFAULT 'SYSTEM',
    action VARCHAR(80) NOT NULL,
    target_type VARCHAR(60) NOT NULL,
    target_id VARCHAR(60) NULL,
    reason TEXT NULL,
    details_json TEXT NULL,
    station_id INT NULL,
    ip_address VARCHAR(60) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_action_created (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS policy_signoffs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    policy_code VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(140) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    decision_notes TEXT NULL,
    confirmed_by VARCHAR(80) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

