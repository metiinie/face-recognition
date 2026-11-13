"use client";

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AuthGuard } from "@/components/AuthGuard";
import { api, AttendanceSessionRecord, EmployeeRecord } from "@/lib/api";
import {
  FileText,
  Download,
  Filter,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  UserCheck,
  ShieldAlert,
  Building2,
  Calendar,
  Edit3,
} from "lucide-react";

export default function ReportsPage() {
  const [sessions, setSessions] = useState<AttendanceSessionRecord[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: number; name: string; code: string }>>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filter state
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedDept, setSelectedDept] = useState<string>("");
  const [selectedEmp, setSelectedEmp] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [selectedPunctuality, setSelectedPunctuality] = useState<string>("");
  const [selectedCaptureMethod, setSelectedCaptureMethod] = useState<string>("");

  // Correction Modal State
  const [activeCorrectionSession, setActiveCorrectionSession] = useState<AttendanceSessionRecord | null>(null);
  const [correctionType, setCorrectionType] = useState<"CHECK_IN_TIME" | "CHECK_OUT_TIME" | "ADD_MISSING_CHECKOUT">("CHECK_IN_TIME");
  const [correctionTimestamp, setCorrectionTimestamp] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionEvidence, setCorrectionEvidence] = useState("");
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionSuccess, setCorrectionSuccess] = useState<string | null>(null);

  const fetchFiltersData = async () => {
    try {
      const [depts, emps] = await Promise.all([api.getDepartments(), api.getEmployees()]);
      setDepartments(depts);
      setEmployees(emps);
    } catch (err) {
      console.error("Failed to load filter metadata:", err);
    }
  };

  const fetchSessions = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAttendanceSessions({
        department_id: selectedDept ? Number(selectedDept) : undefined,
        employee_id: selectedEmp ? Number(selectedEmp) : undefined,
        status: selectedStatus || undefined,
        arrival_status: selectedPunctuality || undefined,
        capture_method: selectedCaptureMethod || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setSessions(res.sessions || []);
    } catch (err) {
      console.error("Failed to load attendance sessions:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFiltersData();
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [dateFrom, dateTo, selectedDept, selectedEmp, selectedStatus, selectedPunctuality, selectedCaptureMethod]);

  const handleClearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setSelectedDept("");
    setSelectedEmp("");
    setSelectedStatus("");
    setSelectedPunctuality("");
    setSelectedCaptureMethod("");
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const blob = await api.exportAttendanceCsv({
        department_id: selectedDept ? Number(selectedDept) : undefined,
        employee_id: selectedEmp ? Number(selectedEmp) : undefined,
        status: selectedStatus || undefined,
        arrival_status: selectedPunctuality || undefined,
        capture_method: selectedCaptureMethod || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const datePart = dateFrom ? `${dateFrom}_to_${dateTo || dateFrom}` : "all";
      a.download = `eipc_attendance_export_${datePart}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Authenticated CSV export failed:", err);
      alert(err.message || "Failed to download authenticated CSV export. Please ensure you are logged in.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenCorrection = (session: AttendanceSessionRecord) => {
    setActiveCorrectionSession(session);
    setCorrectionType(session.check_out ? "CHECK_IN_TIME" : "ADD_MISSING_CHECKOUT");
    setCorrectionTimestamp(
      session.check_in?.timestamp
        ? session.check_in.timestamp.slice(0, 16)
        : `${session.work_date}T08:00`
    );
    setCorrectionReason("");
    setCorrectionEvidence("HR-DISPUTE-FORM-2026");
    setCorrectionError(null);
    setCorrectionSuccess(null);
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCorrectionSession) return;
    if (!correctionReason.trim() || correctionReason.trim().length < 5) {
      setCorrectionError("A mandatory explanation of at least 5 characters is required (AT-23).");
      return;
    }
    if (!correctionTimestamp) {
      setCorrectionError("Corrected timestamp is required.");
      return;
    }

    setIsSubmittingCorrection(true);
    setCorrectionError(null);
    setCorrectionSuccess(null);

    try {
      await api.applyCorrection({
        session_id: activeCorrectionSession.id,
        correction_type: correctionType,
        corrected_timestamp_local: correctionTimestamp,
        reason: correctionReason.trim(),
        evidence_ref: correctionEvidence.trim() || "HR-CORRECTION-DOC",
      });
      setCorrectionSuccess("Attendance correction recorded. Original event preserved in immutable audit logs.");
      fetchSessions();
      setTimeout(() => {
        setActiveCorrectionSession(null);
      }, 1500);
    } catch (err: any) {
      setCorrectionError(err.message || "Failed to apply attendance correction.");
    } finally {
      setIsSubmittingCorrection(false);
    }
  };

  // Compute summary stats for current filtered list
  const totalCount = sessions.length;
  const onTimeCount = sessions.filter((s) => s.arrival_status === "ON_TIME").length;
  const lateCount = sessions.filter((s) => s.arrival_status === "LATE").length;
  const openCount = sessions.filter((s) => s.status === "OPEN").length;
  const manualCount = sessions.filter(
    (s) => s.check_in?.capture_method === "MANUAL_HR" || s.check_out?.capture_method === "MANUAL_HR"
  ).length;

  return (
    <AuthGuard>
      <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Attendance Records &amp; Reports</h1>
          <p className="mt-1 text-xs text-slate-500">
            Multi-criteria attendance queries, punctuality tracking, and official CSV export.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchSessions} isLoading={isLoading}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          <Button
            variant="success"
            size="sm"
            onClick={handleExportCsv}
            isLoading={isExporting}
            disabled={isExporting}
          >
            <Download className="mr-1.5 h-4 w-4" />
            <span>Export CSV</span>
          </Button>
        </div>
      </div>

      {/* KPI Row for Active Query */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="p-3 border-l-4 border-l-blue-600">
          <span className="text-[10px] font-semibold text-slate-500 uppercase">Filtered Sessions</span>
          <div className="text-xl font-bold text-slate-900">{totalCount}</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-emerald-500">
          <span className="text-[10px] font-semibold text-slate-500 uppercase">On-Time Arrivals</span>
          <div className="text-xl font-bold text-emerald-700">{onTimeCount}</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-amber-500">
          <span className="text-[10px] font-semibold text-slate-500 uppercase">Late Arrivals</span>
          <div className="text-xl font-bold text-amber-700">{lateCount}</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-rose-500">
          <span className="text-[10px] font-semibold text-slate-500 uppercase">Missing Check-Outs</span>
          <div className="text-xl font-bold text-rose-700">{openCount}</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-indigo-500">
          <span className="text-[10px] font-semibold text-slate-500 uppercase">Manual HR Overrides</span>
          <div className="text-xl font-bold text-indigo-700">{manualCount}</div>
        </Card>
      </div>

      {/* Multi-Criteria Search & Filter Panel */}
      <Card className="p-5">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Filter className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-800">Multi-Criteria Search Filters</h3>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-[11px] font-medium text-slate-700 block mb-1">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-700 block mb-1">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-700 block mb-1">Department</label>
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-700 block mb-1">Employee</label>
            <select
              value={selectedEmp}
              onChange={(e) => setSelectedEmp(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employee_number} — {e.first_name} {e.last_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-700 block mb-1">Session State</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All States</option>
              <option value="OPEN">OPEN (Missing Check-Out)</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="INCOMPLETE_REVIEW">INCOMPLETE_REVIEW</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-700 block mb-1">Punctuality</label>
            <select
              value={selectedPunctuality}
              onChange={(e) => setSelectedPunctuality(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Arrivals</option>
              <option value="ON_TIME">ON_TIME</option>
              <option value="LATE">LATE</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-700 block mb-1">Capture Method</label>
            <select
              value={selectedCaptureMethod}
              onChange={(e) => setSelectedCaptureMethod(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Verification Methods</option>
              <option value="BIOMETRIC">BIOMETRIC (Face Verified)</option>
              <option value="MANUAL_HR">MANUAL_HR (Documented HR Entry)</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <Button variant="outline" size="sm" onClick={handleClearFilters} className="w-full text-xs">
              Clear All Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Sessions Table */}
      <Card className="p-5">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <CardTitle className="text-base">Attendance Sessions ({sessions.length})</CardTitle>
            <CardDescription>Immutable events tied to college departmental kiosks.</CardDescription>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3">Session</th>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Employee</th>
                <th className="py-2.5 px-3">Department</th>
                <th className="py-2.5 px-3">Shift (EAT)</th>
                <th className="py-2.5 px-3">Check-In</th>
                <th className="py-2.5 px-3">Check-Out</th>
                <th className="py-2.5 px-3">Verification</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 px-3 font-bold text-slate-700">#{s.id}</td>
                  <td className="py-2.5 px-3 text-slate-800 whitespace-nowrap">{s.work_date}</td>
                  <td className="py-2.5 px-3 font-sans">
                    <div className="font-semibold text-slate-900">{s.employee_name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{s.employee_number}</div>
                  </td>
                  <td className="py-2.5 px-3 font-sans text-slate-600">
                    <div>{s.department_name}</div>
                    <div className="text-[10px] text-slate-400">{s.job_category}</div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap text-[10px]">
                    {s.shift_start_eat.split(" ")[1]} → {s.shift_end_eat.split(" ")[1]}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {s.check_in ? (
                      <div>
                        <span className="font-bold text-emerald-700">{s.check_in.time_eat}</span>
                        <div className="text-[9px] text-slate-400">Station: {s.check_in.station_code}</div>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {s.check_out ? (
                      <div>
                        <span className="font-bold text-blue-700">{s.check_out.time_eat}</span>
                        <div className="text-[9px] text-slate-400">Station: {s.check_out.station_code}</div>
                      </div>
                    ) : (
                      <Badge variant="warning" className="text-[9px] py-0 px-1 font-sans">
                        MISSING
                      </Badge>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex flex-col gap-0.5">
                      {s.check_in?.capture_method === "MANUAL_HR" ? (
                        <Badge variant="warning" className="text-[9px] py-0 px-1 font-sans">
                          MANUAL_HR
                        </Badge>
                      ) : (
                        <Badge variant="brand" className="text-[9px] py-0 px-1 font-sans">
                          BIOMETRIC
                        </Badge>
                      )}
                      {s.is_corrected && (
                        <span className="text-[9px] text-rose-600 font-sans font-semibold">
                          HR CORRECTED (AT-23)
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex flex-col gap-0.5 font-sans">
                      {s.arrival_status === "ON_TIME" ? (
                        <Badge variant="success" className="text-[9px] py-0 px-1">
                          ON_TIME
                        </Badge>
                      ) : (
                        <Badge variant="danger" className="text-[9px] py-0 px-1">
                          LATE ({s.late_minutes}m)
                        </Badge>
                      )}
                      <span className="text-[9px] text-slate-400 uppercase font-mono">{s.status}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-[10px] py-0.5 px-2 font-sans"
                      onClick={() => handleOpenCorrection(s)}
                    >
                      <Edit3 className="mr-1 h-3 w-3" /> Correct
                    </Button>
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400 font-sans">
                    No attendance sessions found matching the active filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Attendance Correction Modal (AT-23) */}
      {activeCorrectionSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Correct Attendance Record (AT-23)
                </h3>
                <p className="text-xs text-slate-500">
                  Session #{activeCorrectionSession.id} • {activeCorrectionSession.employee_name} ({activeCorrectionSession.employee_number})
                </p>
              </div>
              <button
                onClick={() => setActiveCorrectionSession(null)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-800">
              <strong>Section 5 Policy:</strong> Corrections never overwrite or delete the original attendance event. A replacement event is linked, preserved in <code>attendance_corrections</code>, and recorded in the immutable audit trail.
            </div>

            <form onSubmit={handleSubmitCorrection} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-medium text-slate-700 block mb-1">Correction Type *</label>
                <select
                  value={correctionType}
                  onChange={(e: any) => setCorrectionType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                >
                  <option value="CHECK_IN_TIME">Adjust Check-In Time</option>
                  <option value="CHECK_OUT_TIME">Adjust Check-Out Time</option>
                  <option value="ADD_MISSING_CHECKOUT">Add Missing Check-Out Event</option>
                </select>
              </div>

              <div>
                <label className="font-medium text-slate-700 block mb-1">Corrected Local Timestamp (EAT) *</label>
                <input
                  type="datetime-local"
                  required
                  value={correctionTimestamp}
                  onChange={(e) => setCorrectionTimestamp(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono"
                />
              </div>

              <div>
                <label className="font-medium text-slate-700 block mb-1">Document Evidence Reference *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dean Written Approval Ref #2026/88"
                  value={correctionEvidence}
                  onChange={(e) => setCorrectionEvidence(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>

              <div>
                <label className="font-medium text-slate-700 block mb-1">Mandatory Reason (min 5 characters) *</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Explain why this correction was approved (e.g. Employee was on approved field trip)..."
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>

              {correctionError && (
                <div className="rounded-lg bg-rose-100 border border-rose-300 p-2 text-rose-800">
                  {correctionError}
                </div>
              )}

              {correctionSuccess && (
                <div className="rounded-lg bg-emerald-100 border border-emerald-300 p-2 text-emerald-800 font-semibold">
                  {correctionSuccess}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveCorrectionSession(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSubmittingCorrection}
                >
                  Save Authorized Correction
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </AuthGuard>
  );
}

