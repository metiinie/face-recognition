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
};

