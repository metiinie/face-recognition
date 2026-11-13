"use client";

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AuthGuard } from "@/components/AuthGuard";
import { api, AttendanceSessionRecord, EmployeeRecord } from "@/lib/api";
import {
  Download,
  Filter,
  RefreshCw,
  Edit3,
  X,
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

  const hasActiveFilters = Boolean(
    dateFrom ||
      dateTo ||
      selectedDept ||
      selectedEmp ||
      selectedStatus ||
      selectedPunctuality ||
      selectedCaptureMethod
  );

  return (
    <AuthGuard>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Attendance Reports
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Query staff attendance logs, filter exceptions, apply AT-23 corrections, and export CSV.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchSessions} isLoading={isLoading}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleExportCsv}
              isLoading={isExporting}
              disabled={isExporting}
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </Button>
          </div>
        </div>

        {/* Query KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Card className="p-3.5">
            <span className="text-[11px] font-medium text-slate-500">Total Sessions</span>
            <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {totalCount}
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500">On Time</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {onTimeCount}
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500">Late Arrivals</span>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {lateCount}
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500">Open Check-Out</span>
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {openCount}
            </div>
          </Card>
          <Card className="p-3.5 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500">Manual HR</span>
              <span className="h-1.5 w-1.5 rounded-full bg-[#4F46E5]" />
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {manualCount}
            </div>
          </Card>
        </div>

        {/* Ledger Noir Filter Strip */}
        <Card className="p-4 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#EAECEF]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 mr-1.5">
                <Filter className="h-3.5 w-3.5 text-[#4F46E5]" />
                Quick Filter:
              </span>
              <button
                type="button"
                onClick={handleClearFilters}
                className={`h-7 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                  !selectedPunctuality && !selectedStatus && !selectedCaptureMethod
                    ? "bg-[#0F172A] text-white"
                    : "bg-[#F6F7F9] text-slate-600 hover:bg-slate-200/70"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedPunctuality(selectedPunctuality === "ON_TIME" ? "" : "ON_TIME")
                }
                className={`h-7 rounded-lg px-2.5 text-xs font-medium border transition-colors ${
                  selectedPunctuality === "ON_TIME"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-white text-slate-600 border-[#E5E7EB] hover:bg-slate-50"
                }`}
              >
                On Time
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedPunctuality(selectedPunctuality === "LATE" ? "" : "LATE")
                }
                className={`h-7 rounded-lg px-2.5 text-xs font-medium border transition-colors ${
                  selectedPunctuality === "LATE"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-white text-slate-600 border-[#E5E7EB] hover:bg-slate-50"
                }`}
              >
                Late
              </button>
              <button
                type="button"
                onClick={() => setSelectedStatus(selectedStatus === "OPEN" ? "" : "OPEN")}
                className={`h-7 rounded-lg px-2.5 text-xs font-medium border transition-colors ${
                  selectedStatus === "OPEN"
                    ? "bg-rose-50 text-rose-700 border-rose-200"
                    : "bg-white text-slate-600 border-[#E5E7EB] hover:bg-slate-50"
                }`}
              >
                Open Sessions
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedCaptureMethod(
                    selectedCaptureMethod === "MANUAL_HR" ? "" : "MANUAL_HR"
                  )
                }
                className={`h-7 rounded-lg px-2.5 text-xs font-medium border transition-colors ${
                  selectedCaptureMethod === "MANUAL_HR"
                    ? "bg-[#EEF2FF] text-[#4338CA] border-indigo-200"
                    : "bg-white text-slate-600 border-[#E5E7EB] hover:bg-slate-50"
                }`}
              >
                Manual HR
              </button>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                <X className="h-3.5 w-3.5" />
                <span>Clear filters</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <label className="text-[11px] font-medium text-slate-500 block mb-1">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs font-mono text-slate-800 focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-500 block mb-1">Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs font-mono text-slate-800 focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-500 block mb-1">Department</label>
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="h-8 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-800 focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
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
              <label className="text-[11px] font-medium text-slate-500 block mb-1">Employee</label>
              <select
                value={selectedEmp}
                onChange={(e) => setSelectedEmp(e.target.value)}
                className="h-8 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-800 focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
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
              <label className="text-[11px] font-medium text-slate-500 block mb-1">Session State</label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="h-8 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-800 focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              >
                <option value="">All States</option>
                <option value="OPEN">OPEN (Missing Check-Out)</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="INCOMPLETE_REVIEW">INCOMPLETE_REVIEW</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-500 block mb-1">Method</label>
              <select
                value={selectedCaptureMethod}
                onChange={(e) => setSelectedCaptureMethod(e.target.value)}
                className="h-8 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-800 focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              >
                <option value="">All Methods</option>
                <option value="BIOMETRIC">BIOMETRIC (Face Verified)</option>
                <option value="MANUAL_HR">MANUAL_HR (HR Entry)</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Attendance Ledger Table */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Attendance Ledger ({sessions.length})</CardTitle>
              <CardDescription>Immutable session records linked to campus kiosks</CardDescription>
            </div>
          </CardHeader>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#EAECEF] bg-[#FAFBFD] text-[10.5px] font-medium uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-2.5 px-4">ID</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Employee</th>
                  <th className="py-2.5 px-3">Department</th>
                  <th className="py-2.5 px-3">Shift (EAT)</th>
                  <th className="py-2.5 px-3">Check-In</th>
                  <th className="py-2.5 px-3">Check-Out</th>
                  <th className="py-2.5 px-3">Verification</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAECEF]">
                {sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-[#FAFBFD] transition-colors">
                    <td className="py-3 px-4 font-mono text-[11px] font-medium text-slate-500 tabular-nums">
                      #{s.id}
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap tabular-nums">
                      {s.work_date}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-900">{s.employee_name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{s.employee_number}</div>
                    </td>
                    <td className="py-3 px-3 text-slate-600">
                      <div>{s.department_name}</div>
                      <div className="text-[11px] text-slate-400">{s.job_category}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                      {s.shift_start_eat.split(" ")[1]} – {s.shift_end_eat.split(" ")[1]}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] tabular-nums">
                      {s.check_in ? (
                        <div>
                          <span className="font-medium text-slate-900">{s.check_in.time_eat}</span>
                          <div className="text-[10px] text-slate-400">{s.check_in.station_code}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] tabular-nums">
                      {s.check_out ? (
                        <div>
                          <span className="font-medium text-slate-900">{s.check_out.time_eat}</span>
                          <div className="text-[10px] text-slate-400">{s.check_out.station_code}</div>
                        </div>
                      ) : (
                        <Badge variant="warning" className="text-[10px]">
                          Missing
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-col gap-1 items-start">
                        {s.check_in?.capture_method === "MANUAL_HR" ? (
                          <Badge variant="warning" className="text-[10px]">
                            Manual HR
                          </Badge>
                        ) : (
                          <Badge variant="brand" className="text-[10px]">
                            Biometric
                          </Badge>
                        )}
                        {s.is_corrected && (
                          <span className="text-[10px] text-rose-600 font-medium">
                            Corrected (AT-23)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-col gap-1 items-start">
                        {s.arrival_status === "ON_TIME" ? (
                          <Badge variant="success" className="text-[10px]">
                            On Time
                          </Badge>
                        ) : (
                          <Badge variant="danger" className="text-[10px]">
                            Late · {s.late_minutes}m
                          </Badge>
                        )}
                        <span className="text-[10px] text-slate-400 font-mono">{s.status}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button variant="outline" size="sm" onClick={() => handleOpenCorrection(s)}>
                        <Edit3 className="h-3 w-3" />
                        <span>Correct</span>
                      </Button>
                    </td>
                  </tr>
                ))}
                {sessions.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-xs text-slate-400">
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-4">
            <div className="w-full max-w-lg rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-xl">
              <div className="flex items-center justify-between border-b border-[#EAECEF] pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Correct Attendance Record (AT-23)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Session #{activeCorrectionSession.id} · {activeCorrectionSession.employee_name} (
                    {activeCorrectionSession.employee_number})
                  </p>
                </div>
                <button
                  onClick={() => setActiveCorrectionSession(null)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-[11px] text-amber-800 leading-relaxed">
                <strong>Append-Only Policy:</strong> Corrections preserve the original attendance event. A replacement entry is stored in{" "}
                <code className="font-mono">attendance_corrections</code> and logged in the audit trail.
              </div>

              <form onSubmit={handleSubmitCorrection} className="mt-4 space-y-3 text-xs">
                <div>
                  <label className="font-medium text-slate-700 block mb-1">Correction Type *</label>
                  <select
                    value={correctionType}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                      setCorrectionType(
                        e.target.value as "CHECK_IN_TIME" | "CHECK_OUT_TIME" | "ADD_MISSING_CHECKOUT"
                      )
                    }
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  >
                    <option value="CHECK_IN_TIME">Adjust Check-In Time</option>
                    <option value="CHECK_OUT_TIME">Adjust Check-Out Time</option>
                    <option value="ADD_MISSING_CHECKOUT">Add Missing Check-Out Event</option>
                  </select>
                </div>

                <div>
                  <label className="font-medium text-slate-700 block mb-1">
                    Corrected Timestamp (EAT) *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={correctionTimestamp}
                    onChange={(e) => setCorrectionTimestamp(e.target.value)}
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 font-mono focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>

                <div>
                  <label className="font-medium text-slate-700 block mb-1">
                    Document Evidence Reference *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Dean Written Approval Ref #2026/88"
                    value={correctionEvidence}
                    onChange={(e) => setCorrectionEvidence(e.target.value)}
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>

                <div>
                  <label className="font-medium text-slate-700 block mb-1">
                    Reason (min 5 characters) *
                  </label>
                  <textarea
                    required
                    rows={2}
                    placeholder="Explain why this correction was approved..."
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    className="w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-2 focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>

                {correctionError && (
                  <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-rose-800">
                    {correctionError}
                  </div>
                )}

                {correctionSuccess && (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-emerald-800 font-medium">
                    {correctionSuccess}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#EAECEF]">
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
                    Save Correction
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

