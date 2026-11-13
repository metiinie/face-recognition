"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AuthGuard } from "@/components/AuthGuard";
import { api, BackupRecord, BackupVerificationResponse, BackupRestoreResponse } from "@/lib/api";
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
  Database,
  HardDrive,
  RotateCcw,
  Trash2,
  Shield,
  AlertCircle,
  Download,
  Lock,
  ExternalLink,
} from "lucide-react";

export default function AuditReviewPage() {
  const [activeTab, setActiveTab] = useState<"logs" | "reviews" | "backups">("logs");
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [reviewCases, setReviewCases] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>("");

  // Backups & Disaster Recovery state
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState<boolean>(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);
  const [isPruningBackups, setIsPruningBackups] = useState<boolean>(false);
  const [backupActionMsg, setBackupActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, BackupVerificationResponse>>({});
  const [isVerifying, setIsVerifying] = useState<Record<string, boolean>>({});
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [backupLabel, setBackupLabel] = useState<string>("manual_snapshot");

  // Restore Modal State
  const [restoreModal, setRestoreModal] = useState<{
    isOpen: boolean;
    filename: string | null;
    confirmText: string;
    adminPassword: string;
    acknowledgement: boolean;
    isRestoring: boolean;
    report: BackupRestoreResponse | null;
    error: string | null;
  }>({
    isOpen: false,
    filename: null,
    confirmText: "",
    adminPassword: "",
    acknowledgement: false,
    isRestoring: false,
    report: null,
    error: null,
  });

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

  const fetchBackups = async () => {
    setIsLoadingBackups(true);
    try {
      const res = await api.listBackups();
      setBackups(res.backups || []);
    } catch (err: any) {
      console.error("Failed to load backups:", err);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchBackups();
  }, []);

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    setBackupActionMsg(null);
    try {
      const res = await api.createBackup({ label: backupLabel.trim() || "manual_snapshot" });
      setShowCreateModal(false);
      setBackupActionMsg({
        type: "success",
        text: `Backup snapshot created: ${res.filename || res.archive_name} (${res.size_kb || Math.round(res.size_bytes / 1024)} KB, ${res.total_records || "all"} records).`,
      });
      await fetchBackups();
    } catch (err: any) {
      setBackupActionMsg({ type: "error", text: err.message || "Failed to create database backup snapshot." });
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleVerifyBackup = async (filename: string) => {
    setIsVerifying((prev) => ({ ...prev, [filename]: true }));
    try {
      const report = await api.verifyBackup(filename);
      setVerifyResults((prev) => ({ ...prev, [filename]: report }));
      setBackupActionMsg({
        type: report.valid ? "success" : "error",
        text: report.valid
          ? `Integrity verified for ${filename}: SHA-256 match, ${report.total_records || "all"} records intact.`
          : `Integrity check failed: ${report.issues?.join(", ") || report.error}`,
      });
    } catch (err: any) {
      setBackupActionMsg({ type: "error", text: err.message || `Integrity verification failed for ${filename}` });
    } finally {
      setIsVerifying((prev) => ({ ...prev, [filename]: false }));
    }
  };

  const handlePruneBackups = async () => {
    if (
      !window.confirm(
        "Apply 30-day retention pruning? Archives older than 30 days will be removed, preserving at least 5 minimum snapshots."
      )
    ) {
      return;
    }
    setIsPruningBackups(true);
    setBackupActionMsg(null);
    try {
      const res = await api.pruneBackups({ retention_days: 30, keep_minimum: 5 });
      setBackupActionMsg({
        type: "success",
        text: `Pruning completed: ${res.pruned_count} archives removed. ${res.remaining_count} backups retained.`,
      });
      await fetchBackups();
    } catch (err: any) {
      setBackupActionMsg({ type: "error", text: err.message || "Failed to prune expired backups." });
    } finally {
      setIsPruningBackups(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!restoreModal.filename || restoreModal.confirmText !== "RESTORE" || !restoreModal.acknowledgement) return;
    setRestoreModal((prev) => ({ ...prev, isRestoring: true, error: null, report: null }));
    try {
      const res = await api.restoreBackup({
        filename: restoreModal.filename,
        confirmation: "RESTORE",
        admin_password: restoreModal.adminPassword.trim() || undefined,
      });
      setRestoreModal((prev) => ({ ...prev, isRestoring: false, report: res }));
      setBackupActionMsg({
        type: "success",
        text: `Database successfully restored from ${restoreModal.filename}. Relational integrity verified.`,
      });
      await fetchData();
    } catch (err: any) {
      setRestoreModal((prev) => ({ ...prev, isRestoring: false, error: err.message || "Restoration failed." }));
    }
  };

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
    <AuthGuard>
      <div className="space-y-6 pb-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EAECEF] pb-5">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
              Security Audit Trail &amp; Disaster Recovery
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Cryptographically verified audit logs, biometric exception review cases, and production database snapshots.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCreateModal(true)}
            >
              <Database className="mr-1.5 h-3.5 w-3.5 text-[#4F46E5]" />
              Take Backup Snapshot
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleOpenManualModal()}
            >
              <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
              Record Manual HR Attendance
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchData();
                fetchBackups();
              }}
              isLoading={isLoading || isLoadingBackups}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>

        {/* Global Action Banner */}
        {backupActionMsg && (
          <div
            className={`flex items-center justify-between rounded-xl px-4 py-3 text-xs border ${
              backupActionMsg.type === "success"
                ? "border-emerald-200 bg-emerald-50/80 text-emerald-800"
                : "border-rose-200 bg-rose-50/80 text-rose-800"
            }`}
          >
            <div className="flex items-center gap-2">
              {backupActionMsg.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
              )}
              <span className="font-medium">{backupActionMsg.text}</span>
            </div>
            <button
              onClick={() => setBackupActionMsg(null)}
              className="text-slate-400 hover:text-slate-700 p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Segmented Tabs */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-1.5 flex items-center overflow-x-auto gap-1">
          <button
            onClick={() => setActiveTab("logs")}
            className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === "logs"
                ? "bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-[#F6F7F9]"
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            <span>Audit Trail</span>
            <span className="rounded-md bg-white/80 border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-slate-700">
              {auditLogs.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("reviews")}
            className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === "reviews"
                ? "bg-amber-50 text-amber-800 border border-amber-200"
                : "text-slate-600 hover:text-slate-900 hover:bg-[#F6F7F9]"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Review Queue</span>
            {reviewCases.length > 0 ? (
              <Badge variant="warning" className="text-[10px] py-0 px-1.5 font-mono tabular-nums">
                {reviewCases.length}
              </Badge>
            ) : (
              <span className="rounded-md bg-white/80 border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-slate-600">
                0
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("backups")}
            className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === "backups"
                ? "bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-[#F6F7F9]"
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            <span>Disaster Recovery &amp; Backups</span>
            <span className="rounded-md bg-white/80 border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-slate-700">
              {backups.length}
            </span>
          </button>
        </div>

        {/* Tab 1: Audit Log Stream */}
        {activeTab === "logs" && (
          <Card>
            <CardHeader className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <CardTitle>Immutable Audit Records</CardTitle>
                <CardDescription>Cryptographically tied administrator and biometric operations.</CardDescription>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1 bg-[#F6F7F9] border border-[#EAECEF] rounded-lg p-1">
                  {[
                    { label: "All", value: "" },
                    { label: "Templates", value: "FACE_TEMPLATE" },
                    { label: "Attendance", value: "ATTENDANCE" },
                    { label: "Auth", value: "AUTH" },
                    { label: "Purges", value: "PURGED" },
                    { label: "Backups", value: "DATABASE_BACKUP" },
                  ].map((chip) => (
                    <button
                      key={chip.value || "all"}
                      type="button"
                      onClick={() => setFilterAction(chip.value)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        filterAction === chip.value
                          ? "bg-white text-slate-900 shadow-xs border border-[#E5E7EB]/80"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <Filter className="h-3.5 w-3.5 text-slate-400" />
                  <select
                    value={filterAction}
                    onChange={(e) => setFilterAction(e.target.value)}
                    className="h-8 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-700 focus:border-[#4F46E5] focus:outline-none font-mono"
                  >
                    <option value="">All Actions</option>
                    <option value="FACE_TEMPLATE">Face Template Events</option>
                    <option value="ATTENDANCE">Attendance Events</option>
                    <option value="PURGED">Data Purge Events</option>
                    <option value="AUTH">Authentication Events</option>
                    <option value="DATABASE_BACKUP">Database Backup Events</option>
                  </select>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#EAECEF] bg-[#F6F7F9]/80 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-4">Timestamp (EAT)</th>
                      <th className="py-2.5 px-4">Action</th>
                      <th className="py-2.5 px-4">Actor</th>
                      <th className="py-2.5 px-4">Target ID</th>
                      <th className="py-2.5 px-4">IP / Station</th>
                      <th className="py-2.5 px-4">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAECEF] font-mono text-[11px]">
                    {filteredLogs.map((log, idx) => (
                      <tr key={log.id || idx} className="hover:bg-[#F6F7F9]/60 transition-colors">
                        <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap tabular-nums">
                          {new Date(log.created_at || Date.now()).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4">
                          <Badge
                            variant={
                              log.action?.includes("PURGE") || log.action?.includes("REVOKE")
                                ? "warning"
                                : log.action?.includes("FAIL") || log.action?.includes("REJECT")
                                ? "danger"
                                : "brand"
                            }
                            className="text-[10px] py-0 px-1.5 font-mono"
                          >
                            {log.action}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-4 text-slate-900 font-semibold font-sans">{log.actor_username || "system"}</td>
                        <td className="py-2.5 px-4 text-slate-600 tabular-nums">{log.target_id || "-"}</td>
                        <td className="py-2.5 px-4 text-slate-500 tabular-nums">{log.ip_address || "127.0.0.1"}</td>
                        <td className="py-2.5 px-4 text-slate-600 font-sans max-w-xs truncate">{log.details || "-"}</td>
                      </tr>
                    ))}
                    {filteredLogs.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400 font-sans text-xs">
                          No audit events match the selected criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tab 2: Review Cases Panel */}
        {activeTab === "reviews" && (
          <div className="space-y-4">
            {reviewCases.length > 0 ? (
              <Card className="border-amber-200 overflow-hidden">
                <div className="flex items-center justify-between border-b border-amber-200/70 bg-amber-50/70 px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700 border border-amber-200">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-amber-950">
                        {reviewCases.length} Pending Biometric Review Case(s)
                      </h4>
                      <p className="text-[11px] text-amber-800">
                        Unresolved unknown face scans, camera glare anomalies, or unassisted staff punches flagged for HR adjudication.
                      </p>
                    </div>
                  </div>
                  <Badge variant="warning">Action Required</Badge>
                </div>

                <div className="overflow-x-auto bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#EAECEF] bg-[#F6F7F9]/80 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-4">Case ID</th>
                        <th className="py-2.5 px-4">Logged (EAT)</th>
                        <th className="py-2.5 px-4">Terminal Station</th>
                        <th className="py-2.5 px-4">Case Type</th>
                        <th className="py-2.5 px-4">Claimed Staff ID</th>
                        <th className="py-2.5 px-4">Reason / Details</th>
                        <th className="py-2.5 px-4 text-right">HR Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAECEF] text-[11px]">
                      {reviewCases.map((rc) => (
                        <tr key={rc.id} className="hover:bg-amber-50/30 transition-colors">
                          <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 tabular-nums">#{rc.id}</td>
                          <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap tabular-nums">
                            {new Date(rc.created_at || Date.now()).toLocaleTimeString()}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-slate-700">
                            {rc.station_code || `Station #${rc.station_id || 1}`}
                          </td>
                          <td className="py-2.5 px-4">
                            <Badge variant="warning" className="text-[10px] py-0 px-1.5 font-mono">
                              {rc.case_type || rc.review_type || "UNKNOWN_FACE"}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-4 font-mono font-medium text-slate-800">
                            {rc.claimed_employee_number || "—"}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 max-w-sm">
                            {rc.reason || rc.notes || "Assistance requested at station kiosk."}
                          </td>
                          <td className="py-2.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                            <Button
                              variant="success"
                              size="sm"
                              className="h-7 text-[11px] px-2.5"
                              onClick={() => handleOpenManualModal(rc)}
                            >
                              <UserCheck className="mr-1 h-3 w-3 inline" />
                              Approve Manual Entry
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[11px] px-2.5 text-rose-600 hover:bg-rose-50 border border-rose-200"
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
              <Card className="border-emerald-200 bg-emerald-50/50 p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-800">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>Zero pending review cases. All biometric recognition events resolved cleanly.</span>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Tab 3: Database Backups & Disaster Recovery Console */}
        {activeTab === "backups" && (
          <div className="space-y-5">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <Card>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Available Backups</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{backups.length} Snapshots</p>
                  </div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EEF2FF] text-[#4F46E5]">
                    <Database className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Retention Policy</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">30 Days (Keep min 5)</p>
                  </div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                    <HardDrive className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Integrity Verification</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-700">SHA-256 Checksums</p>
                  </div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Backups List & Actions */}
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-[#4F46E5]" />
                    Production Database Archives
                  </CardTitle>
                  <CardDescription>
                    Self-contained compressed gzip JSON snapshots with pre-computed SHA-256 sidecars.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href="/backups"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#C7D2FE] bg-[#EEF2FF] px-3 py-1.5 text-xs font-medium text-[#4338CA] hover:bg-[#E0E7FF] transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Full DR Console</span>
                  </Link>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowCreateModal(true)}
                  >
                    <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                    <span>Create Snapshot</span>
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePruneBackups}
                    isLoading={isPruningBackups}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                    <span>Apply Retention Prune</span>
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchBackups}
                    isLoading={isLoadingBackups}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#EAECEF] bg-[#F6F7F9]/80 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-4">Archive File</th>
                        <th className="py-2.5 px-4">Created Date (EAT)</th>
                        <th className="py-2.5 px-4">Size</th>
                        <th className="py-2.5 px-4">SHA-256 Checksum</th>
                        <th className="py-2.5 px-4">Integrity Status</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAECEF] font-mono text-[11px]">
                      {backups.map((b) => {
                        const fname = b.filename || b.archive_name || "unknown_backup";
                        const sizeDisplay = b.size_kb
                          ? `${b.size_kb} KB`
                          : b.size_human || `${Math.round((b.size_bytes || 0) / 1024)} KB`;
                        const vRes = verifyResults[fname];
                        const verifying = isVerifying[fname];

                        return (
                          <tr key={fname} className="hover:bg-[#F6F7F9]/60 transition-colors">
                            <td className="py-2.5 px-4 font-semibold text-slate-900">
                              <div className="flex items-center gap-2">
                                <HardDrive className="h-3.5 w-3.5 text-[#4F46E5] shrink-0" />
                                <span>{fname}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap tabular-nums">
                              {new Date(b.created_at || Date.now()).toLocaleString()}
                            </td>
                            <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap tabular-nums">
                              {sizeDisplay}
                            </td>
                            <td className="py-2.5 px-4 text-slate-400 font-mono text-[10px]">
                              {b.sha256 ? `${b.sha256.slice(0, 16)}...` : "—"}
                            </td>
                            <td className="py-2.5 px-4">
                              {verifying ? (
                                <Badge variant="outline" className="text-[10px] py-0 px-1.5 inline-flex items-center gap-1">
                                  <RefreshCw className="h-3 w-3 animate-spin text-[#4F46E5]" />
                                  <span>Verifying...</span>
                                </Badge>
                              ) : vRes ? (
                                vRes.valid ? (
                                  <Badge variant="success" className="text-[10px] py-0 px-1.5 inline-flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                    <span>SHA-256 Validated</span>
                                  </Badge>
                                ) : (
                                  <Badge variant="danger" className="text-[10px] py-0 px-1.5 inline-flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3 text-rose-600" />
                                    <span>Integrity Failed</span>
                                  </Badge>
                                )
                              ) : b.has_checksum ? (
                                <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-mono text-slate-600">
                                  Checksum Available
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-slate-400">
                                  Unchecked
                                </Badge>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-[11px] px-2.5"
                                onClick={() => handleVerifyBackup(fname)}
                                isLoading={verifying}
                              >
                                <ShieldCheck className="h-3 w-3 mr-1 text-emerald-600 inline" />
                                Verify Integrity
                              </Button>

                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[11px] px-2.5 text-rose-600 hover:bg-rose-50 border border-rose-200"
                                onClick={() => {
                                  setRestoreModal({
                                    isOpen: true,
                                    filename: fname,
                                    confirmText: "",
                                    adminPassword: "",
                                    acknowledgement: false,
                                    isRestoring: false,
                                    report: null,
                                    error: null,
                                  });
                                }}
                              >
                                <RotateCcw className="h-3 w-3 mr-1 inline" />
                                Restore Database
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                      {backups.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-400 font-sans text-xs">
                            No database backup archives found. Click &ldquo;Create Snapshot&rdquo; to create your first consistent recovery archive.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Modal: Create Backup Snapshot */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-[#EAECEF] pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EEF2FF] text-[#4F46E5]">
                    <Database className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Create Database Backup</h3>
                    <p className="text-xs text-slate-500">Atomic snapshot with cryptographic SHA-256 checksum.</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-[#F6F7F9] hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    Snapshot Label / Tag (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. pre_upgrade_v2, biometrics_sync, manual"
                    value={backupLabel}
                    onChange={(e) => setBackupLabel(e.target.value)}
                    className="w-full h-9 rounded-lg border border-[#E5E7EB] px-3 text-xs font-mono focus:border-[#4F46E5] focus:outline-none"
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Label will be appended to the archive filename for clear identification.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EAECEF]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateModal(false)}
                  disabled={isCreatingBackup}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleCreateBackup}
                  isLoading={isCreatingBackup}
                >
                  Create Consistent Snapshot
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Disaster Recovery Database Restore Confirmation */}
        {restoreModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4 border border-rose-200">
              <div className="flex items-center justify-between border-b border-rose-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600 border border-rose-200">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-rose-950">
                      Disaster Recovery: Restore Database
                    </h3>
                    <p className="text-xs text-rose-700">
                      Warning: Destructive operation rolls back live data.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setRestoreModal((prev) => ({ ...prev, isOpen: false }))}
                  className="rounded-lg p-1 text-slate-400 hover:bg-[#F6F7F9] hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {restoreModal.error && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800">
                  {restoreModal.error}
                </div>
              )}

              {restoreModal.report && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Database Restoration Complete</span>
                  </div>
                  <p className="tabular-nums">
                    Restored {restoreModal.report.restored_records || restoreModal.report.total_records_restored || 0} records. Relational integrity verified.
                  </p>
                </div>
              )}

              {!restoreModal.report && (
                <div className="space-y-3 text-xs text-slate-700">
                  <div className="rounded-lg bg-rose-50/60 border border-rose-200 p-3 text-rose-900 space-y-1.5">
                    <p className="font-medium">
                      You are about to restore the database from:
                    </p>
                    <p className="font-mono text-[11px] bg-white px-2.5 py-1.5 rounded-md border border-rose-200 text-slate-900">
                      {restoreModal.filename}
                    </p>
                    <p className="text-[11px] text-rose-800 leading-relaxed">
                      This will replace current attendance sessions, employee records, shift assignments, and face templates with the contents of this archive. Live vector caches will be atomically refreshed.
                    </p>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-700 block mb-1">
                      Type <span className="font-mono text-rose-600 font-semibold">RESTORE</span> to confirm:
                    </label>
                    <input
                      type="text"
                      value={restoreModal.confirmText}
                      onChange={(e) => setRestoreModal((prev) => ({ ...prev, confirmText: e.target.value }))}
                      placeholder="Type RESTORE in capital letters"
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] px-3 text-xs font-mono uppercase focus:border-rose-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-700 block mb-1">
                      Administrator Password (Step-Up Re-Authentication)
                    </label>
                    <input
                      type="password"
                      value={restoreModal.adminPassword}
                      onChange={(e) => setRestoreModal((prev) => ({ ...prev, adminPassword: e.target.value }))}
                      placeholder="Enter current administrator password"
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] px-3 text-xs focus:border-rose-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-start gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="audit-ack-restore"
                      checked={restoreModal.acknowledgement}
                      onChange={(e) => setRestoreModal((prev) => ({ ...prev, acknowledgement: e.target.checked }))}
                      className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                    />
                    <label htmlFor="audit-ack-restore" className="text-[11px] text-slate-600 cursor-pointer select-none leading-relaxed">
                      I acknowledge that this action will permanently replace all current database tables and reload biometric memory caches.
                    </label>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EAECEF]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRestoreModal((prev) => ({ ...prev, isOpen: false }))}
                  disabled={restoreModal.isRestoring}
                >
                  {restoreModal.report ? "Close" : "Cancel"}
                </Button>

                {!restoreModal.report && (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={
                      restoreModal.confirmText !== "RESTORE" ||
                      !restoreModal.acknowledgement ||
                      restoreModal.isRestoring
                    }
                    isLoading={restoreModal.isRestoring}
                    onClick={handleRestoreBackup}
                  >
                    Confirm Destructive Restoration
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal: HR Manual Attendance Approval / Recording */}
        {isManualModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-[#EAECEF] pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <UserCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {selectedCaseForApproval ? `Approve Review Case #${selectedCaseForApproval.id}` : "Record Manual HR Attendance"}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Mandatory documented reason and evidence reference are cryptographically audited.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsManualModalOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-[#F6F7F9] hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
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
                    <label className="text-[11px] font-medium text-slate-700 block mb-1">
                      Employee *
                    </label>
                    <select
                      value={manualForm.employee_id}
                      onChange={(e) => setManualForm({ ...manualForm, employee_id: Number(e.target.value) })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] px-2.5 text-xs bg-white focus:border-[#4F46E5] focus:outline-none"
                    >
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.employee_number} — {emp.first_name} {emp.last_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-700 block mb-1">
                      Station *
                    </label>
                    <select
                      value={manualForm.station_id}
                      onChange={(e) => setManualForm({ ...manualForm, station_id: Number(e.target.value) })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] px-2.5 text-xs bg-white focus:border-[#4F46E5] focus:outline-none font-mono"
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
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    Attendance Action *
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setManualForm({ ...manualForm, event_type: "CHECK_IN" })}
                      className={`rounded-lg h-9 text-xs font-medium border text-center transition-colors ${
                        manualForm.event_type === "CHECK_IN"
                          ? "bg-emerald-50 border-emerald-500 text-emerald-800"
                          : "bg-white border-[#E5E7EB] text-slate-600 hover:bg-[#F6F7F9]"
                      }`}
                    >
                      CHECK-IN (መግቢያ)
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualForm({ ...manualForm, event_type: "CHECK_OUT" })}
                      className={`rounded-lg h-9 text-xs font-medium border text-center transition-colors ${
                        manualForm.event_type === "CHECK_OUT"
                          ? "bg-[#EEF2FF] border-[#4F46E5] text-[#4338CA]"
                          : "bg-white border-[#E5E7EB] text-slate-600 hover:bg-[#F6F7F9]"
                      }`}
                    >
                      CHECK-OUT (መውጫ)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    Mandatory Justification / Reason * (min 5 characters)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Employee verified physically; camera sensor connection failure"
                    value={manualForm.reason}
                    onChange={(e) => setManualForm({ ...manualForm, reason: e.target.value })}
                    className="w-full h-9 rounded-lg border border-[#E5E7EB] px-3 text-xs focus:border-[#4F46E5] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    Evidence Reference / Document ID *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Department physical register Book #2 Pg 44, or Gate Officer Slip #81"
                    value={manualForm.evidence_reference}
                    onChange={(e) => setManualForm({ ...manualForm, evidence_reference: e.target.value })}
                    className="w-full h-9 rounded-lg border border-[#E5E7EB] px-3 text-xs focus:border-[#4F46E5] focus:outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-[#EAECEF]">
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
                    variant="success"
                    size="sm"
                    isLoading={isSubmittingManual}
                  >
                    Confirm Manual Attendance Punch
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

