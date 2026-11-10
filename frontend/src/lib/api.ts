/**
 * Typed API Client for Ethio-Italy Polytechnic College
 * Face Attendance Management System (Version 1)
 */

const API_BASE = "";

export interface UserProfile {
  id: number;
  username: string;
  role: "SYSTEM_ADMIN" | "HR_OFFICER" | "DEPT_HEAD" | "KIOSK_OPERATOR";
  fullName?: string;
  departmentId?: number;
}

export interface BiometricEvaluationMetrics {
  far: number;
  frr: number;
  eer: number;
  operating_threshold: number;
  total_genuine_pairs: number;
  total_impostor_pairs: number;
  recognition_latency_ms: {
    mean: number;
    p95: number;
    p99: number;
    breakdown: {
      detection_ms: number;
      alignment_ms: number;
      liveness_ms: number;
      onnx_inference_ms: number;
      db_search_ms: number;
    };
  };
  liveness_pad: {
    attack_detection_rate: number;
    apcer: number;
    bpcer: number;
    attacks_tested: {
      printed_photos: { tested: number; blocked: number; pass_rate_percent: number };
      screen_glare_displays: { tested: number; blocked: number; pass_rate_percent: number };
      video_screen_moire: { tested: number; blocked: number; pass_rate_percent: number };
    };
  };
  roc_det_curves: Array<{
    threshold: number;
    far: number;
    frr: number;
    tpr: number; // 1 - frr
  }>;
}

export interface AttendanceSessionRecord {
  id: number;
  work_date: string;
  employee_id: number;
  employee_number: string;
  employee_name: string;
  department_id?: number;
  department_name: string;
  job_category: string;
  shift_start_eat: string;
  shift_end_eat: string;
  arrival_status: "ON_TIME" | "LATE";
  late_minutes: number;
  status: "OPEN" | "COMPLETED" | "INCOMPLETE_REVIEW";
  is_corrected: boolean;
  check_in?: {
    id: number;
    time_eat: string;
    timestamp: string;
    capture_method: "BIOMETRIC" | "MANUAL_HR" | string;
    station_code: string;
    score?: number;
  } | null;
  check_out?: {
    id: number;
    time_eat: string;
    timestamp: string;
    capture_method: "BIOMETRIC" | "MANUAL_HR" | string;
    station_code: string;
    score?: number;
  } | null;
}

export interface EmployeeRecord {
  id: number;
  employee_number: string;
  first_name: string;
  last_name: string;
  job_category: string;
  department_name: string;
  department_id: number;
  status: string;
  has_active_template: boolean;
  template_model_version?: string;
  consent_verified: boolean;
}

export interface ShiftTemplateRecord {
  id: number;
  name: string;
  job_category: 'REGULAR_STAFF' | 'CLEANING_STAFF' | 'SECURITY_GUARD' | string;
  start_time: string;
  end_time: string;
  spans_midnight: boolean;
  is_24_hour: boolean;
  break_rules?: string;
  grace_period_minutes: number;
  early_checkin_window_minutes?: number;
  hr_approved: boolean;
  status: string;
  ethiopian_display: string;
}

export interface ShiftAssignmentRecord {
  id: number;
  employee_id: number;
  employee_number: string;
  employee_name: string;
  shift_template_id: number;
  shift_name: string;
  ethiopian_display: string;
  effective_from: string;
  effective_to?: string | null;
  working_days: string;
  approved_by: string;
}

export interface ScheduleExceptionRecord {
  id: number;
  title: string;
  exception_type: 'PUBLIC_HOLIDAY' | 'APPROVED_LEAVE' | string;
  employee_id?: number | null;
  employee_number: string;
  employee_name: string;
  start_date: string;
  end_date: string;
  reason?: string | null;
  approved_by: string;
}

export interface StationRecord {
  id: number;
  station_code: string;
  name: string;
  department_id: number;
  department_code: string;
  department_name: string;
  location: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE' | string;
  camera_status: string;
  station_secret_token?: string;
}

export interface PolicySignoffRecord {
  id: number;
  policy_code: string;
  title: string;
  description: string;
  status: 'CONFIRMED' | 'PENDING_CONFIRMATION' | string;
  decision_notes?: string | null;
  confirmed_by?: string | null;
  updated_at?: string;
}

export interface ContinuousFaceResult {
  track_id: number;
  bounding_box: { x: number; y: number; w: number; h: number };
  matched: boolean;
  status: "MATCHED" | "UNCERTAIN_MATCH" | "UNKNOWN_FACE" | "EMPLOYEE_INACTIVE" | "CONSENT_NOT_VERIFIED" | string;
  recognition_score: number;
  quality_score: number;
  liveness_passed: boolean;
  employee?: {
    id: number;
    employee_number: string;
    full_name: string;
    department?: string;
    job_category?: string;
    status: string;
  } | null;
  action_status: "CONFIRMED" | "COOLDOWN_ACTIVE" | "ALREADY_CHECKED_IN" | "NO_OPEN_SESSION" | "UNKNOWN_VISITOR" | "REJECTED" | "ACQUIRING_TRACK" | "UNCERTAIN_TRACK" | "ALREADY_PUNCHED_IN_PASSAGE" | "SPOOF_BLOCKED" | "STATIONARY_LINGER" | "CONSENT_BLOCKED" | string;
  attendance_action?: "CHECK_IN" | "CHECK_OUT" | null;
  session_id?: number | null;
  is_late?: boolean;
  minutes_late?: number;
  message?: string;
  review_case_id?: number;
  spoof_detected?: boolean;
  spoof_type?: string | null;
  frames_seen?: number;
  motion_direction?: "APPROACHING" | "RECEDING" | "STATIONARY" | string;
  is_punch_committed?: boolean;
}

export interface ContinuousEntranceFrameResponse {
  station_code: string;
  station_name: string;
  gate_mode: "IN" | "OUT" | "AUTO_DETECT" | "BIDIRECTIONAL" | string;
  timestamp: string;
  timestamp_eat: string;
  faces_detected: number;
  faces: ContinuousFaceResult[];
  summary_actions: string[];
  telemetry?: {
    fps: number;
    inference_ms: number;
    active_tracks: number;
    camera_status: string;
    model_pipeline?: {
      detector: string;
      recognizer: string;
      tracker: string;
      pad_liveness: string;
    };
  };
}

export interface GatePassageRecord {
  id: string | number;
  timestamp_eat: string;
  employee_number: string;
  employee_name: string;
  department?: string;
  event_type: "CHECK_IN" | "CHECK_OUT";
  match_score: number;
  station_code: string;
  is_late?: boolean;
}

export interface GateStatusResponse {
  station_code: string;
  station_name: string;
  department?: string;
  location: string;
  camera_status: string;
  gate_mode: string;
  cooldown_sec: number;
  min_checkout_elapsed_mins?: number;
  min_persistence_frames?: number;
  today_total_passages: number;
  today_checkins: number;
  today_checkouts: number;
  recent_passages: GatePassageRecord[];
}

export interface MultiFaceBenchmarkResponse {
  hardware: {
    cpu_count: number;
    platform: string;
    processor: string;
    ram_gb: number;
  };
  samples_per_scenario: number;
  enrolled_templates: number;
  frame_resolution: string;
  concurrency_results: Record<
    number,
    {
      faces_requested: number;
      faces_detected: number;
      fps: number;
      e2e_latency: { mean: number; p50: number; p95: number };
      decode_ms: number;
      detect_ms: number;
      align_ms: number;
      liveness_ms: number;
      sface_ms: number;
      vector_search_ms: number;
      linear_search_ms: number;
      search_speedup: number;
      usable: boolean;
    }
  >;
}

export interface KeyRotationResponse {
  status: "SUCCESS" | "ERROR";
  rotated_count: number;
  total_templates: number;
}

export interface BackupRecord {
  archive_name: string;
  archive_path: string;
  checksum_path: string;
  size_bytes: number;
  size_human: string;
  created_at: string;
  has_valid_checksum: boolean;
  checksum_sha256: string;
}

export interface BackupListResponse {
  backups: BackupRecord[];
  count: number;
}

export interface BackupCreationResponse {
  status: string;
  archive_name: string;
  archive_path: string;
  checksum_path: string;
  sha256: string;
  size_bytes: number;
  tables_included: string[];
}

export interface BackupVerificationResponse {
  valid: boolean;
  archive_name: string;
  calculated_sha256: string;
  expected_sha256: string;
  checksum_matched: boolean;
  decompressed_size_bytes: number;
  tables_found: string[];
  tables_missing: string[];
  error?: string;
}

export interface BackupRestoreResponse {
  status: string;
  archive_name: string;
  records_restored: Record<string, number>;
  total_records_restored: number;
  relational_integrity: {
    foreign_keys_valid: boolean;
    broken_constraints: any[];
  };
}

export interface BackupPruneResponse {
  status: string;
  retention_days: number;
  keep_minimum: number;
  pruned_count: number;
  pruned_archives: string[];
  remaining_count: number;
}

export interface RecognitionResult {
  matched: boolean;
  status: "MATCH_CONFIRMED" | "UNCERTAIN_MATCH" | "UNKNOWN_FACE" | "REJECTED" | "CONSENT_NOT_VERIFIED";
  employee?: {
    id: number;
    employee_number: string;
    first_name: string;
    last_name: string;
    department_name: string;
    job_category: string;
  };
  match_score?: number;
  recognition_token?: string;
  quality_score?: number;
  liveness_passed?: boolean;
  rejection_code?: string;
  rejection_message?: string;
  latency_ms?: number;
}

export interface AttendanceConfirmResponse {
  success: boolean;
  message: string;
  event_type: "CHECK_IN" | "CHECK_OUT";
  timestamp: string;
  shift_name?: string;
  is_late?: boolean;
  minutes_late?: number;
  is_overtime?: boolean;
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("eipc_jwt_token");
}

export function setStoredToken(token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("eipc_jwt_token", token);
    document.cookie = `eipc_jwt_token=${encodeURIComponent(token)}; path=/; max-age=86400; SameSite=Lax`;
  }
}

export function removeStoredToken(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("eipc_jwt_token");
    localStorage.removeItem("eipc_user");
    document.cookie = "eipc_jwt_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
  }
}

export function getStoredUser(): UserProfile | null {
  if (typeof window === "undefined") return null;
  const userJson = localStorage.getItem("eipc_user");
  if (!userJson) return null;
  try {
    return JSON.parse(userJson);
  } catch {
    return null;
  }
}

let isRedirectingToLogin = false;

/**
 * Centralized 401 Unauthorized handler.
 * Clears expired credentials and redirects to login while preserving the intended destination.
 */
export function handleUnauthorized(currentPath?: string): void {
  removeStoredToken();
  if (typeof window === "undefined" || isRedirectingToLogin) return;

  const pathname = window.location.pathname;
  if (pathname === "/login") return;

  // Public kiosk & entrance terminals handle their own terminal errors without hijacking the screen
  const isPublicTerminal = pathname.startsWith("/kiosk") || pathname.startsWith("/entrance");
  if (isPublicTerminal && !currentPath) return;

  isRedirectingToLogin = true;
  const destination = currentPath || (window.location.pathname + window.location.search);
  const targetUrl = `/login?redirect=${encodeURIComponent(destination)}&expired=1`;
  window.location.href = targetUrl;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (res.status === 401 && endpoint !== "/api/auth/login") {
    // Clear invalid / expired session tokens and redirect to login preserving destination
    handleUnauthorized();
    let errMessage = "Authentication required. Please log in.";
    try {
      const errJson = await res.json();
      errMessage = errJson.error || errJson.message || errMessage;
    } catch {
      // ignore
    }
    throw new Error(errMessage);
  }

  if (!res.ok) {
    let errMessage = `HTTP error ${res.status}`;
    try {
      const errJson = await res.json();
      errMessage = errJson.error || errJson.message || errMessage;
    } catch {
      // ignore
    }
    throw new Error(errMessage);
  }

  return res.json();
}

export const api = {
  async login(username: string, password: string):Promise<{ access_token: string; user: UserProfile }> {
    const data = await request<{ access_token: string; user: UserProfile }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setStoredToken(data.access_token);
    if (typeof window !== "undefined") {
      localStorage.setItem("eipc_user", JSON.stringify(data.user));
    }
    return data;
  },

  async getMe(): Promise<UserProfile> {
    return request<UserProfile>("/api/auth/me");
  },

  logout(): void {
    removeStoredToken();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  },

  async getStationCurrent(): Promise<{ provisioned: boolean; station?: StationRecord; message?: string }> {
    return request("/api/station/current");
  },

  async provisionStation(station_code: string): Promise<{ status: string; station: StationRecord; message: string }> {
    return request("/api/station/provision", {
      method: "POST",
      body: JSON.stringify({ station_code }),
    });
  },

  async unbindStation(): Promise<{ status: string; message: string }> {
    return request("/api/station/unbind", {
      method: "POST",
    });
  },

  async getStationDirectory(): Promise<{ stations: StationRecord[]; employees: EmployeeRecord[] }> {
    return request("/api/station/directory");
  },

  async quickEnrollFace(payload: {
    employee_id: number;
    image_base64: string;
    quality_mode?: string;
  }): Promise<any> {
    return request("/api/station/quick-enroll", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getAttendanceSummary(): Promise<any> {
    return request("/api/attendance/summary");
  },

  async getDepartments(): Promise<Array<{ id: number; name: string; code: string }>> {
    const res = await request<any>("/api/departments");
    return Array.isArray(res) ? res : (res.departments || []);
  },

  async getEmployees(params?: { q?: string; department_id?: number }): Promise<EmployeeRecord[]> {
    const query = new URLSearchParams();
    if (params?.q) query.set("q", params.q);
    if (params?.department_id) query.set("department_id", String(params.department_id));
    const res = await request<any>(`/api/employees?${query.toString()}`);
    return Array.isArray(res) ? res : (res.employees || []);
  },

  async createEmployee(payload: {
    employee_number: string;
    first_name: string;
    last_name: string;
    department_id: number;
    job_category: string;
    phone?: string;
    consent_verified?: boolean;
  }): Promise<{ status: string; employee: EmployeeRecord }> {
    return request("/api/employees", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async updateEmployee(
    empId: number,
    data: {
      first_name?: string;
      last_name?: string;
      department_id?: number;
      job_category?: string;
      phone?: string;
      consent_verified?: boolean;
    }
  ): Promise<{ status: string; employee: EmployeeRecord }> {
    return request(`/api/employees/${empId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async setEmployeeStatus(
    empId: number,
    status: "ACTIVE" | "INACTIVE",
    reason?: string
  ): Promise<{ status: string; employee_id: number; new_status: string }> {
    return request(`/api/employees/${empId}/status`, {
      method: "POST",
      body: JSON.stringify({ status, reason: reason || "HR status update" }),
    });
  },

  async recognizeFace(payload: {
    image_base64?: string;
    station_id?: string;
    quality_mode?: string;
    biometric_signature?: string;
  }): Promise<RecognitionResult> {
    return request("/api/face/recognize", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async confirmAttendance(payload: {
    recognition_token: string;
    station_id: string;
    event_type?: "CHECK_IN" | "CHECK_OUT";
    override_reason?: string;
  }): Promise<AttendanceConfirmResponse> {
    return request("/api/attendance/confirm", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async enrollFace(payload: {
    employee_id: number;
    image_base64: string;
    quality_mode?: string;
  }): Promise<any> {
    return request("/api/face/enroll", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async purgeBiometrics(employeeId: number, reason: string): Promise<any> {
    return request("/api/face/purge", {
      method: "POST",
      body: JSON.stringify({ employee_id: employeeId, reason }),
    });
  },

  async getBiometricMetrics(): Promise<BiometricEvaluationMetrics> {
    return request("/api/face/biometric-metrics");
  },

  async getModelReport(): Promise<any> {
    return request("/api/face/model-report");
  },

  async syncModelTemplates(): Promise<any> {
    return request("/api/face/sync-model-templates", {
      method: "POST",
    });
  },

  async runRetentionCleanup(): Promise<any> {
    return request("/api/face/retention-cleanup", {
      method: "POST",
    });
  },

  async getAuditLogs(limit = 50): Promise<any[]> {
    return request(`/api/audit-logs?limit=${limit}`);
  },

  async getReviewCases(): Promise<any[]> {
    return request("/api/review-cases");
  },

  async requestStationReview(payload: {
    station_id?: string;
    station_code?: string;
    station_token?: string;
    case_type?: string;
    reason?: string;
    claimed_employee_number?: string;
    candidate_employee_id?: number | null;
  }): Promise<{ status: string; review_case_id: number; message: string }> {
    return request("/api/station/request-review", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getAttendanceSessions(filters?: {
    department_id?: number;
    employee_id?: number;
    status?: string;
    arrival_status?: string;
    capture_method?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<{ sessions: AttendanceSessionRecord[]; total: number }> {
    const query = new URLSearchParams();
    if (filters?.department_id) query.set("department_id", String(filters.department_id));
    if (filters?.employee_id) query.set("employee_id", String(filters.employee_id));
    if (filters?.status) query.set("status", filters.status);
    if (filters?.arrival_status) query.set("arrival_status", filters.arrival_status);
    if (filters?.capture_method) query.set("capture_method", filters.capture_method);
    if (filters?.date_from) query.set("date_from", filters.date_from);
    if (filters?.date_to) query.set("date_to", filters.date_to);
    return request(`/api/reports/sessions?${query.toString()}`);
  },

  async exportAttendanceCsv(params: Record<string, any>): Promise<Blob> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== "" && val !== "ALL") {
        searchParams.append(key, String(val));
      }
    });

    const token = getStoredToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`/api/reports/export.csv?${searchParams.toString()}`, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Export failed with status ${res.status}`);
    }

    return await res.blob();
  },

  async dismissReviewCase(caseId: number, reason: string): Promise<any> {
    return request(`/api/review-cases/${caseId}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },

  async recordManualAttendance(payload: {
    employee_id: number;
    station_id: number;
    event_type: "CHECK_IN" | "CHECK_OUT";
    reason: string;
    evidence_reference: string;
    review_case_id?: number;
    occurred_at_local?: string;
  }): Promise<any> {
    return request("/api/review/manual-entry", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async applyCorrection(payload: {
    session_id: number;
    correction_type: "CHECK_IN_TIME" | "CHECK_OUT_TIME" | "ADD_MISSING_CHECKOUT";
    corrected_timestamp_local: string;
    reason: string;
    evidence_ref?: string;
  }): Promise<any> {
    return request("/api/attendance/correct", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getShiftTemplates(): Promise<ShiftTemplateRecord[]> {
    return request('/api/shifts/templates');
  },

  async createShiftTemplate(payload: {
    name: string;
    job_category: string;
    start_time: string;
    end_time: string;
    grace_period_minutes?: number;
    spans_midnight?: boolean;
    is_24_hour?: boolean;
    break_rules?: string;
    hr_approved?: boolean;
  }): Promise<any> {
    return request('/api/shifts/templates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getShiftAssignments(employeeId?: number): Promise<ShiftAssignmentRecord[]> {
    const q = employeeId ? `?employee_id=${employeeId}` : "";
    return request(`/api/shifts/assignments${q}`);
  },

  async assignShift(payload: {
    employee_id: number;
    shift_template_id: number;
    effective_from: string;
    effective_to?: string | null;
    working_days?: string;
  }): Promise<any> {
    return request('/api/shifts/assign', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getScheduleExceptions(): Promise<ScheduleExceptionRecord[]> {
    return request('/api/shifts/exceptions');
  },

  async createScheduleException(payload: {
    title: string;
    exception_type: string;
    start_date: string;
    end_date: string;
    employee_id?: number | null;
    reason?: string;
  }): Promise<any> {
    return request('/api/shifts/exceptions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getStations(): Promise<StationRecord[]> {
    return request('/api/stations');
  },

  async createStation(payload: {
    station_code: string;
    name: string;
    department_id: number;
    location: string;
    station_secret_token?: string;
  }): Promise<any> {
    return request('/api/stations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getPolicies(): Promise<PolicySignoffRecord[]> {
    return request('/api/policies');
  },

  async updatePolicy(
    policyId: number,
    payload: { status?: string; decision_notes?: string; confirmed_by?: string }
  ): Promise<any> {
    return request(`/api/policies/${policyId}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async processContinuousEntranceFrame(payload: {
    station_code: string;
    station_id?: string;
    image_base64?: string;
    gate_mode?: string;
    simulated_staff?: string[];
  }): Promise<ContinuousEntranceFrameResponse> {
    return request('/api/v2/entrance/process-frame', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getGateStatus(stationCode = 'ST-GATE-01'): Promise<GateStatusResponse> {
    return request(`/api/v2/entrance/status?station_code=${stationCode}`);
  },

  async configureGate(payload: {
    station_code: string;
    gate_mode: string;
    cooldown_sec?: number;
    min_checkout_elapsed_mins?: number;
    min_persistence_frames?: number;
  }): Promise<any> {
    return request('/api/v2/entrance/gate-config', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async simulateGatePassage(payload: {
    station_code: string;
    simulated_staff: string[];
    gate_mode?: string;
  }): Promise<ContinuousEntranceFrameResponse> {
    return request('/api/v2/entrance/simulate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async runMultiFaceBenchmark(payload?: {
    face_counts?: number[];
    num_samples?: number;
    num_enrolled?: number;
  }): Promise<MultiFaceBenchmarkResponse> {
    return request('/api/v2/entrance/benchmark', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },

  async rotateBiometricKeys(payload?: {
    new_secret?: string;
    old_secrets?: string[];
  }): Promise<KeyRotationResponse> {
    return request('/api/v2/security/rotate-biometric-keys', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },

  async listBackups(): Promise<BackupListResponse> {
    return request('/api/v2/admin/backups');
  },

  async createBackup(payload?: { label?: string }): Promise<BackupCreationResponse> {
    return request('/api/v2/admin/backups/create', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },

  async verifyBackup(filename: string): Promise<BackupVerificationResponse> {
    return request('/api/v2/admin/backups/verify', {
      method: 'POST',
      body: JSON.stringify({ filename }),
    });
  },

  async restoreBackup(filename: string): Promise<BackupRestoreResponse> {
    return request('/api/v2/admin/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ filename }),
    });
  },

  async pruneBackups(payload?: {
    retention_days?: number;
    keep_minimum?: number;
  }): Promise<BackupPruneResponse> {
    return request('/api/v2/admin/backups/prune', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },
};

