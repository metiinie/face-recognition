"use client";

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import {
  ShieldAlert,
  ShieldCheck,
  Search,
  Filter,
  CheckCircle,
  Clock,
  RefreshCw,
  AlertTriangle,
  UserCheck,
  FileText,
  CheckCircle2,
  X,
  PlusCircle,
} from "lucide-react";

export default function AuditReviewPage() {
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [reviewCases, setReviewCases] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>("");

  // Manual Attendance Approval Modal
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [selectedCaseForApproval, setSelectedCaseForApproval] = useState<any | null>(null);
  const [manualForm, setManualForm] = useState({
    employee_id: 1,
    station_id: 1,
    event_type: "CHECK_IN" as "CHECK_IN" | "CHECK_OUT",
    reason: "",
    evidence_reference: "",
    review_case_id: undefined as number | undefined,
  });
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState<string | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [logs, cases, emps, stList] = await Promise.all([
        api.getAuditLogs(100),
        api.getReviewCases(),
        api.getEmployees().catch(() => []),
        api.getStations().catch(() => []),
      ]);
      setAuditLogs(logs);
      setReviewCases(cases);
      if (Array.isArray(emps)) setEmployees(emps);
      if (Array.isArray(stList)) setStations(stList);
    } catch (err) {
      console.error("Failed to load audit logs:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenManualModal = (caseItem?: any) => {
    setManualError(null);
    setManualSuccess(null);
    if (caseItem) {
      setSelectedCaseForApproval(caseItem);
      const matched = employees.find(
        (e) => e.employee_number === caseItem.claimed_employee_number
      );
      setManualForm({
        employee_id: matched?.id || (employees[0]?.id || 1),
        station_id: caseItem.station_id || (stations[0]?.id || 1),
        event_type: "CHECK_IN",
        reason: caseItem.reason || "Manual HR attendance verification following unrecognized face review.",
        evidence_reference: `Physical ID / Badge verified by HR - Review Case #${caseItem.id}`,
        review_case_id: caseItem.id,
      });
    } else {
      setSelectedCaseForApproval(null);
      setManualForm({
        employee_id: employees[0]?.id || 1,
        station_id: stations[0]?.id || 1,
        event_type: "CHECK_IN",
        reason: "Documented HR manual attendance entry.",
        evidence_reference: "Department register logbook verification",
        review_case_id: undefined,
      });
    }
    setIsManualModalOpen(true);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.reason || manualForm.reason.trim().length < 5) {
      setManualError("A documented reason (at least 5 characters) is mandatory.");
      return;
    }
    if (!manualForm.evidence_reference || !manualForm.evidence_reference.trim()) {
      setManualError("Policy evidence / reference ID is mandatory for manual HR attendance.");
      return;
    }

    setIsSubmittingManual(true);
    setManualError(null);
    try {
      await api.recordManualAttendance({
        employee_id: Number(manualForm.employee_id),
        station_id: Number(manualForm.station_id),
        event_type: manualForm.event_type,
        reason: manualForm.reason.trim(),
        evidence_reference: manualForm.evidence_reference.trim(),
        review_case_id: manualForm.review_case_id,
      });

      setManualSuccess("Manual HR attendance recorded and audited successfully!");
      await fetchData();
      setTimeout(() => {
        setIsManualModalOpen(false);
        setManualSuccess(null);
      }, 1500);
    } catch (err: any) {
      setManualError(err.message || "Failed to record manual HR attendance.");
    } finally {
      setIsSubmittingManual(false);
    }
  };

  const filteredLogs = filterAction
    ? auditLogs.filter((log) => log.action.includes(filterAction))
    : auditLogs;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Security Audit Trail & Exception Queue</h1>
          <p className="mt-1 text-xs text-slate-500">
            Immutable system event logs, biometric template modifications, and exception review cases.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleOpenManualModal()}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 font-semibold"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            <span>Record Manual HR Attendance</span>
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData} isLoading={isLoading}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh Audit Stream
          </Button>
        </div>
      </div>

      {/* Review Cases Panel */}
      {reviewCases.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/40 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-amber-200/80 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-600 text-white">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-amber-950">
                  {reviewCases.length} Pending Biometric Review Case(s)
                </h4>
                <p className="text-[11px] text-amber-800">
                  Unresolved unknown face scans, camera glare anomalies, or unassisted staff punches flagged for HR adjudication.
                </p>
              </div>
            </div>
            <Badge variant="warning" className="text-xs">Action Required</Badge>
          </div>

          <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-amber-200 bg-amber-100/60 text-[10px] font-semibold text-amber-900 uppercase tracking-wider">
                <tr>
                  <th className="py-2 px-3">Case ID</th>
                  <th className="py-2 px-3">Logged (EAT)</th>
                  <th className="py-2 px-3">Terminal Station</th>
                  <th className="py-2 px-3">Case Type</th>
                  <th className="py-2 px-3">Claimed Staff ID</th>
                  <th className="py-2 px-3">Reason / Details</th>
                  <th className="py-2 px-3 text-right">HR Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 text-[11px]">
                {reviewCases.map((rc) => (
                  <tr key={rc.id} className="hover:bg-amber-50/60">
                    <td className="py-2.5 px-3 font-mono font-bold text-amber-900">#{rc.id}</td>
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                      {new Date(rc.created_at || Date.now()).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-700">
                      {rc.station_code || `Station #${rc.station_id || 1}`}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge variant="warning" className="text-[9px] py-0 px-1 font-mono">
                        {rc.case_type || rc.review_type || "UNKNOWN_FACE"}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                      {rc.claimed_employee_number || "—"}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 max-w-sm">
                      {rc.reason || rc.notes || "Assistance requested at station kiosk."}
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-1.5 whitespace-nowrap">
                      <Button
                        variant="primary"
                        size="sm"
                        className="text-[10px] py-1 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                        onClick={() => handleOpenManualModal(rc)}
                      >
                        <UserCheck className="mr-1 h-3 w-3 inline" />
                        Approve Manual Entry
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[10px] py-1 px-2 text-rose-600 hover:bg-rose-50 border border-rose-200"
                        onClick={async () => {
                          const conf = window.confirm(`Dismiss Review Case #${rc.id}?`);
                          if (!conf) return;
                          try {
                            await api.dismissReviewCase(rc.id, "Spurious scan dismissed by HR");
                            fetchData();
                          } catch (err: any) {
                            alert(err.message || "Failed to dismiss case");
                          }
                        }}
                      >
                        Dismiss
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="border-emerald-200 bg-emerald-50/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Zero pending review cases. All biometric recognition events resolved cleanly.</span>
          </div>
        </Card>
      )}

      {/* Audit Log Table */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <CardTitle className="text-base">Immutable Audit Records</CardTitle>
            <CardDescription>Cryptographically tied administrator and biometric operations.</CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white py-1.5 px-3 text-xs focus:ring-1 focus:ring-blue-500 font-mono"
            >
              <option value="">All Actions</option>
              <option value="FACE_TEMPLATE">Face Template Events</option>
              <option value="ATTENDANCE">Attendance Events</option>
              <option value="PURGED">Data Purge Events</option>
              <option value="AUTH">Authentication Events</option>
            </select>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3">Timestamp (EAT)</th>
                <th className="py-2.5 px-3">Action</th>
                <th className="py-2.5 px-3">Actor</th>
                <th className="py-2.5 px-3">Target ID</th>
                <th className="py-2.5 px-3">IP / Station</th>
                <th className="py-2.5 px-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {filteredLogs.map((log, idx) => (
                <tr key={log.id || idx} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                    {new Date(log.created_at || Date.now()).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3">
                    <Badge
                      variant={
                        log.action?.includes("PURGE") || log.action?.includes("REVOKE")
                          ? "warning"
                          : log.action?.includes("FAIL") || log.action?.includes("REJECT")
                          ? "danger"
                          : "brand"
                      }
                      className="text-[9px] py-0 px-1.5 font-mono"
                    >
                      {log.action}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-3 text-slate-800 font-semibold">{log.actor_username || "system"}</td>
                  <td className="py-2.5 px-3 text-slate-600">{log.target_id || "-"}</td>
                  <td className="py-2.5 px-3 text-slate-400">{log.ip_address || "127.0.0.1"}</td>
                  <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">{log.details || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal: HR Manual Attendance Approval / Recording */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <UserCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {selectedCaseForApproval ? `Approve Review Case #${selectedCaseForApproval.id}` : "Record Manual HR Attendance"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Mandatory documented reason and evidence reference are cryptographically audited.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsManualModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {manualSuccess && (
              <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{manualSuccess}</span>
              </div>
            )}

            {manualError && (
              <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200">
                {manualError}
              </div>
            )}

            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Employee *
                  </label>
                  <select
                    value={manualForm.employee_id}
                    onChange={(e) => setManualForm({ ...manualForm, employee_id: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.employee_number} — {emp.first_name} {emp.last_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Station *
                  </label>
                  <select
                    value={manualForm.station_id}
                    onChange={(e) => setManualForm({ ...manualForm, station_id: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  >
                    {stations.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.station_code} ({st.name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Attendance Action *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setManualForm({ ...manualForm, event_type: "CHECK_IN" })}
                    className={`rounded-lg p-2 text-xs font-semibold border text-center transition-colors ${
                      manualForm.event_type === "CHECK_IN"
                        ? "bg-emerald-50 border-emerald-500 text-emerald-800"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    CHECK-IN (መግቢያ)
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualForm({ ...manualForm, event_type: "CHECK_OUT" })}
                    className={`rounded-lg p-2 text-xs font-semibold border text-center transition-colors ${
                      manualForm.event_type === "CHECK_OUT"
                        ? "bg-indigo-50 border-indigo-500 text-indigo-800"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    CHECK-OUT (መውጫ)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Mandatory Justification / Reason * (min 5 characters)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Employee verified physically; camera sensor connection failure"
                  value={manualForm.reason}
                  onChange={(e) => setManualForm({ ...manualForm, reason: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Evidence Reference / Document ID *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Department physical register Book #2 Pg 44, or Gate Officer Slip #81"
                  value={manualForm.evidence_reference}
                  onChange={(e) => setManualForm({ ...manualForm, evidence_reference: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsManualModalOpen(false)}
                  disabled={isSubmittingManual}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSubmittingManual}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Confirm Manual Attendance Punch
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

