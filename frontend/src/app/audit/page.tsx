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
      <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Security Audit Trail & Disaster Recovery
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
            className="flex items-center gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
          >
            <Database className="h-3.5 w-3.5" />
            <span>Take Backup Snapshot</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleOpenManualModal()}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 font-semibold"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            <span>Record Manual HR Attendance</span>
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
          className={`flex items-center justify-between rounded-xl p-3 text-xs border ${
            backupActionMsg.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
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
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-200 gap-1">
        <button
          onClick={() => setActiveTab("logs")}
          className={`py-2 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === "logs"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
          }`}
        >
          <Shield className="h-3.5 w-3.5" />
          <span>Audit Trail</span>
          <Badge variant="outline" className="text-[10px] py-0 px-1 font-mono">
            {auditLogs.length}
          </Badge>
        </button>

        <button
          onClick={() => setActiveTab("reviews")}
          className={`py-2 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === "reviews"
              ? "border-amber-600 text-amber-600"
              : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>Review Queue</span>
          {reviewCases.length > 0 ? (
            <Badge variant="warning" className="text-[10px] py-0 px-1 font-mono">
              {reviewCases.length}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] py-0 px-1 font-mono">
              0
            </Badge>
          )}
        </button>

        <button
          onClick={() => setActiveTab("backups")}
          className={`py-2 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === "backups"
              ? "border-emerald-600 text-emerald-600"
              : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
          }`}
        >
          <Database className="h-3.5 w-3.5" />
          <span>Disaster Recovery & Backups</span>
          <Badge variant="brand" className="text-[10px] py-0 px-1 font-mono">
            {backups.length}
          </Badge>
        </button>
      </div>

      {/* Tab 1: Audit Log Stream */}
      {activeTab === "logs" && (
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
                <option value="DATABASE_BACKUP">Database Backup Events</option>
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
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-400">
                      No audit events match the selected criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Tab 2: Review Cases Panel */}
      {activeTab === "reviews" && (
        <div className="space-y-4">
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
        </div>
      )}

      {/* Tab 3: Database Backups & Disaster Recovery Console */}
      {activeTab === "backups" && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 bg-slate-50 border-slate-200">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">Available Backups</p>
                  <p className="text-lg font-bold text-slate-900">{backups.length} Snapshots</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-slate-50 border-slate-200">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">Retention Policy</p>
                  <p className="text-xs font-bold text-slate-800">30 Days (Keep min 5)</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-slate-50 border-slate-200">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">Integrity Verification</p>
                  <p className="text-xs font-bold text-emerald-800">SHA-256 Checksums</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Backups List & Actions */}
          <Card className="p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4 text-blue-600" />
                  Production Database Archives
                </CardTitle>
                <CardDescription>
                  Self-contained compressed gzip JSON snapshots with pre-computed SHA-256 sidecars.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href="/backups"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors shadow-sm"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Full DR Console</span>
                </Link>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 font-semibold"
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  <span>Create Snapshot</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePruneBackups}
                  isLoading={isPruningBackups}
                  className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 border-slate-300"
                >
                  <Trash2 className="h-3.5 w-3.5 text-slate-400" />
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
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Archive File</th>
                    <th className="py-2.5 px-3">Created Date (EAT)</th>
                    <th className="py-2.5 px-3">Size</th>
                    <th className="py-2.5 px-3">SHA-256 Checksum</th>
                    <th className="py-2.5 px-3">Integrity Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {backups.map((b) => {
                    const fname = b.filename || b.archive_name || "unknown_backup";
                    const sizeDisplay = b.size_kb
                      ? `${b.size_kb} KB`
                      : b.size_human || `${Math.round((b.size_bytes || 0) / 1024)} KB`;
                    const vRes = verifyResults[fname];
                    const verifying = isVerifying[fname];

                    return (
                      <tr key={fname} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-semibold text-slate-800 flex items-center gap-2">
                          <HardDrive className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                          <span>{fname}</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                          {new Date(b.created_at || Date.now()).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                          {sizeDisplay}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 font-mono text-[10px]">
                          {b.sha256 ? `${b.sha256.slice(0, 16)}...` : "—"}
                        </td>
                        <td className="py-2.5 px-3">
                          {verifying ? (
                            <Badge variant="outline" className="text-[9px] py-0 px-1.5 flex items-center gap-1">
                              <RefreshCw className="h-3 w-3 animate-spin text-blue-600" />
                              <span>Verifying...</span>
                            </Badge>
                          ) : vRes ? (
                            vRes.valid ? (
                              <Badge variant="brand" className="text-[9px] py-0 px-1.5 flex items-center gap-1 bg-emerald-50 text-emerald-700 border-emerald-300">
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                <span>SHA-256 Validated</span>
                              </Badge>
                            ) : (
                              <Badge variant="danger" className="text-[9px] py-0 px-1.5 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3 text-rose-600" />
                                <span>Integrity Failed</span>
                              </Badge>
                            )
                          ) : b.has_checksum ? (
                            <Badge variant="outline" className="text-[9px] py-0 px-1.5 font-mono text-slate-600">
                              Checksum Available
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-slate-400">
                              Unchecked
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-1.5 whitespace-nowrap">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-[10px] py-1 px-2.5 border-slate-300 hover:bg-slate-100"
                            onClick={() => handleVerifyBackup(fname)}
                            isLoading={verifying}
                          >
                            <ShieldCheck className="h-3 w-3 mr-1 text-emerald-600 inline" />
                            Verify Integrity
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[10px] py-1 px-2.5 text-rose-600 hover:bg-rose-50 border border-rose-200"
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
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        No database backup archives found. Click "Create Snapshot" to create your first consistent recovery archive.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Modal: Create Backup Snapshot */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Create Database Backup</h3>
                  <p className="text-xs text-slate-500">Atomic snapshot with cryptographic SHA-256 checksum.</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Snapshot Label / Tag (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. pre_upgrade_v2, biometrics_sync, manual"
                  value={backupLabel}
                  onChange={(e) => setBackupLabel(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:ring-1 focus:ring-blue-500 font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Label will be appended to the archive filename for clear identification.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
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
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
              >
                Create Consistent Snapshot
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Disaster Recovery Database Restore Confirmation */}
      {restoreModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 border-2 border-rose-300">
            <div className="flex items-center justify-between border-b border-rose-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-rose-900">
                    Disaster Recovery: Restore Database
                  </h3>
                  <p className="text-xs text-rose-700">
                    Warning: Destructive operation rolls back live data.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setRestoreModal((prev) => ({ ...prev, isOpen: false }))}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {restoreModal.error && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800">
                {restoreModal.error}
              </div>
            )}

            {restoreModal.report && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Database Restoration Complete!</span>
                </div>
                <p>
                  Restored {restoreModal.report.restored_records || restoreModal.report.total_records_restored || 0} records. Relational integrity verified.
                </p>
              </div>
            )}

            {!restoreModal.report && (
              <div className="space-y-3 text-xs text-slate-700">
                <div className="rounded-lg bg-rose-50/60 border border-rose-200 p-3 text-rose-900 space-y-1.5">
                  <p className="font-semibold">
                    You are about to restore the database from:
                  </p>
                  <p className="font-mono text-[11px] bg-white p-1.5 rounded border border-rose-200 text-slate-900">
                    {restoreModal.filename}
                  </p>
                  <p className="text-[11px] text-rose-800">
                    This will replace current attendance sessions, employee records, shift assignments, and face templates with the contents of this archive. Live vector caches will be atomically refreshed.
                  </p>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Type <span className="font-mono text-rose-600 font-bold">RESTORE</span> to confirm:
                  </label>
                  <input
                    type="text"
                    value={restoreModal.confirmText}
                    onChange={(e) => setRestoreModal((prev) => ({ ...prev, confirmText: e.target.value }))}
                    placeholder="Type RESTORE in capital letters"
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs font-mono uppercase focus:ring-1 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Administrator Password (Step-Up Re-Authentication)
                  </label>
                  <input
                    type="password"
                    value={restoreModal.adminPassword}
                    onChange={(e) => setRestoreModal((prev) => ({ ...prev, adminPassword: e.target.value }))}
                    placeholder="Enter current administrator password"
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:ring-1 focus:ring-rose-500"
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
                  <label htmlFor="audit-ack-restore" className="text-[11px] text-slate-600 cursor-pointer select-none">
                    I acknowledge that this action will permanently replace all current database tables and reload biometric memory caches.
                  </label>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t">
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
                  className="bg-rose-600 hover:bg-rose-700 text-white font-medium"
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
    </AuthGuard>
  );
}

