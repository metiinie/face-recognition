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
  status: "MATCHED" | "UNCERTAIN_MATCH" | "UNKNOWN_FACE" | "EMPLOYEE_INACTIVE" | string;
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
  action_status: "CONFIRMED" | "COOLDOWN_ACTIVE" | "ALREADY_CHECKED_IN" | "NO_OPEN_SESSION" | "UNKNOWN_VISITOR" | "REJECTED" | string;
  attendance_action?: "CHECK_IN" | "CHECK_OUT" | null;
  session_id?: number | null;
  is_late?: boolean;
  minutes_late?: number;
  message?: string;
  review_case_id?: number;
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
  today_total_passages: number;
  today_checkins: number;
  today_checkouts: number;
  recent_passages: GatePassageRecord[];
}

export interface RecognitionResult {
  matched: boolean;
  status: "MATCH_CONFIRMED" | "UNCERTAIN_MATCH" | "UNKNOWN_FACE" | "REJECTED";
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
  }
}

export function removeStoredToken(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("eipc_jwt_token");
    localStorage.removeItem("eipc_user");
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

let autoLoginPromise: Promise<string | null> | null = null;

async function autoLoginHROfficer(): Promise<string | null> {
  if (autoLoginPromise) return autoLoginPromise;
  autoLoginPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "hr_officer", password: "Hr@EIPC2026" }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.access_token) {
        setStoredToken(data.access_token);
        if (typeof window !== "undefined") {
          localStorage.setItem("eipc_user", JSON.stringify(data.user));
        }
        return data.access_token;
      }
    } catch {
      return null;
    } finally {
      autoLoginPromise = null;
    }
    return null;
  })();
  return autoLoginPromise;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let token = getStoredToken();
  if (!token && endpoint !== "/api/auth/login") {
    token = await autoLoginHROfficer();
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (res.status === 401 && endpoint !== "/api/auth/login") {
    const newToken = await autoLoginHROfficer();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });
    }
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
};

