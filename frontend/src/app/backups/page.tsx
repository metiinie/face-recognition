"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AuthGuard } from "@/components/AuthGuard";
import {
  api,
  BackupRecord,
  BackupVerificationResponse,
  BackupRestoreResponse,
} from "@/lib/api";
import {
  Database,
  HardDrive,
  Shield,
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
  PlusCircle,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Lock,
  X,
  FileCheck2,
  Calendar,
  Clock,
  Search,
  Copy,
  ExternalLink,
} from "lucide-react";

export default function BackupsPage() {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "verified" | "unverified" | "issues">("all");

  // Action states
  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);
  const [isPruningBackups, setIsPruningBackups] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Verification state per archive
  const [verifyResults, setVerifyResults] = useState<Record<string, BackupVerificationResponse>>({});
  const [isVerifying, setIsVerifying] = useState<Record<string, boolean>>({});
  const [isVerifyingAll, setIsVerifyingAll] = useState<boolean>(false);

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [backupLabel, setBackupLabel] = useState<string>("manual_snapshot");

  // Restore Modal State (Strong Authorization)
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

  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const fetchBackups = async () => {
    setIsLoading(true);
    try {
      const res = await api.listBackups();
      setBackups(res.backups || []);
    } catch (err: any) {
      console.error("Failed to load backups list:", err);
      setActionMessage({
        type: "error",
        text: err.message || "Failed to retrieve database backup archives.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleCreateBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingBackup(true);
    setActionMessage(null);
    try {
      const res = await api.createBackup({ label: backupLabel.trim() || "manual_snapshot" });
      setShowCreateModal(false);
      const name = res.filename || res.archive_name || "New Archive";
      const sizeStr = res.size_kb ? `${res.size_kb} KB` : `${Math.round((res.size_bytes || 0) / 1024)} KB`;
      setActionMessage({
        type: "success",
        text: `Backup snapshot created successfully: ${name} (${sizeStr}, ${res.total_records ?? "all"} records).`,
      });
      await fetchBackups();
    } catch (err: any) {
      setActionMessage({
        type: "error",
        text: err.message || "Failed to generate database backup snapshot.",
      });
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleVerifyBackup = async (filename: string) => {
    setIsVerifying((prev) => ({ ...prev, [filename]: true }));
    try {
      const report = await api.verifyBackup(filename);
      setVerifyResults((prev) => ({ ...prev, [filename]: report }));
      setActionMessage({
        type: report.valid ? "success" : "error",
        text: report.valid
          ? `Integrity verified for ${filename}: SHA-256 match, gzip valid, all authoritative tables intact.`
          : `Integrity verification failed for ${filename}: ${report.issues?.join("; ") || report.error || "Unknown issue"}`,
      });
    } catch (err: any) {
      setActionMessage({
        type: "error",
        text: err.message || `Integrity check failed for ${filename}.`,
      });
    } finally {
      setIsVerifying((prev) => ({ ...prev, [filename]: false }));
    }
  };

  const handleVerifyAll = async () => {
    setIsVerifyingAll(true);
    setActionMessage({ type: "info", text: "Verifying cryptographic SHA-256 and gzip integrity of all archives..." });
    let passed = 0;
    let failed = 0;

    for (const b of backups) {
      const fname = b.filename || b.archive_name;
      if (!fname) continue;
      try {
        const report = await api.verifyBackup(fname);
        setVerifyResults((prev) => ({ ...prev, [fname]: report }));
        if (report.valid) passed++;
        else failed++;
      } catch {
        failed++;
      }
    }

    setIsVerifyingAll(false);
    setActionMessage({
      type: failed === 0 ? "success" : "error",
      text: `Batch integrity check complete: ${passed} archive(s) verified intact, ${failed} failed or corrupted.`,
    });
  };

  const handlePruneBackups = async () => {
    if (
      !window.confirm(
        "Apply automated 30-day retention pruning?\n\nArchives older than 30 days will be securely purged, preserving at least 5 newest snapshots."
      )
    ) {
      return;
    }

    setIsPruningBackups(true);
    setActionMessage(null);
    try {
      const res = await api.pruneBackups({ retention_days: 30, keep_minimum: 5 });
      setActionMessage({
        type: "success",
        text: `Retention policy applied: ${res.pruned_count} expired archives pruned. ${res.remaining_count} backups preserved.`,
      });
      await fetchBackups();
    } catch (err: any) {
      setActionMessage({
        type: "error",
        text: err.message || "Failed to prune expired database backups.",
      });
    } finally {
      setIsPruningBackups(false);
    }
  };

  const handleInitiateRestore = (filename: string) => {
    setRestoreModal({
      isOpen: true,
      filename,
      confirmText: "",
      adminPassword: "",
      acknowledgement: false,
      isRestoring: false,
      report: null,
      error: null,
    });
    // Auto-verify if not already verified
    if (!verifyResults[filename]) {
      handleVerifyBackup(filename);
    }
  };

  const handleExecuteRestore = async () => {
    if (
      !restoreModal.filename ||
      restoreModal.confirmText !== "RESTORE" ||
      !restoreModal.acknowledgement
    ) {
      return;
    }

    setRestoreModal((prev) => ({ ...prev, isRestoring: true, error: null, report: null }));
    try {
      const res = await api.restoreBackup({
        filename: restoreModal.filename,
        confirmation: "RESTORE",
        admin_password: restoreModal.adminPassword.trim() || undefined,
      });

      setRestoreModal((prev) => ({ ...prev, isRestoring: false, report: res }));
      setActionMessage({
        type: "success",
        text: `Disaster recovery completed successfully from ${restoreModal.filename}. Relational tables and in-memory caches re-synchronized.`,
      });
      await fetchBackups();
    } catch (err: any) {
      setRestoreModal((prev) => ({
        ...prev,
        isRestoring: false,
        error: err.message || "Disaster recovery restoration failed. Review server audit logs for details.",
      }));
    }
  };

  const handleCopyHash = (hash: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 2000);
    }
  };

  // Filtered backups list
  const filteredBackups = useMemo(() => {
    return backups.filter((b) => {
      const name = (b.filename || b.archive_name || "").toLowerCase();
      const matchesSearch = !searchQuery.trim() || name.includes(searchQuery.toLowerCase().trim());
      if (!matchesSearch) return false;

      const fname = b.filename || b.archive_name || "";
      const result = verifyResults[fname];

      if (statusFilter === "verified") return result?.valid === true;
      if (statusFilter === "unverified") return !result;
      if (statusFilter === "issues") return result && !result.valid;
      return true;
    });
  }, [backups, searchQuery, statusFilter, verifyResults]);

  // Total storage calculation
  const totalSizeBytes = useMemo(() => {
    return backups.reduce((acc, b) => acc + (b.size_bytes || (b.size_kb ? b.size_kb * 1024 : 0)), 0);
  }, [backups]);

  const totalStorageFormatted = useMemo(() => {
    if (totalSizeBytes > 1024 * 1024) {
      return `${(totalSizeBytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${Math.round(totalSizeBytes / 1024)} KB`;
  }, [totalSizeBytes]);

  return (
    <AuthGuard allowedRoles={["SYSTEM_ADMIN"]}>
      <div className="space-y-6 pb-12">
        {/* Header with Title and Administrative Scope */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#EAECEF] pb-5">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
              Disaster Recovery &amp; Database Backups
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Institutional point-in-time snapshots, SHA-256 cryptographic verification, automated retention, and audited restoration.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand" className="font-mono text-[11px] px-2.5 py-1">
              Role: System Administrator
            </Badge>
            <Link
              href="/audit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-[#F6F7F9] transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
              <span>Audit Trail</span>
            </Link>
          </div>
        </div>

        {/* Global Feedback Banner */}
        {actionMessage && (
          <div
            className={`flex items-center justify-between rounded-xl px-4 py-3 text-xs border ${
              actionMessage.type === "success"
                ? "bg-emerald-50/80 border-emerald-200 text-emerald-900"
                : actionMessage.type === "error"
                ? "bg-rose-50/80 border-rose-200 text-rose-900"
                : "bg-[#EEF2FF] border-[#C7D2FE] text-[#3730A3]"
            }`}
          >
            <div className="flex items-center gap-2">
              {actionMessage.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
              {actionMessage.type === "error" && <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />}
              {actionMessage.type === "info" && <RefreshCw className="h-4 w-4 text-[#4F46E5] animate-spin shrink-0" />}
              <span>{actionMessage.text}</span>
            </div>
            <button
              onClick={() => setActionMessage(null)}
              className="text-slate-400 hover:text-slate-700 p-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Top 4 Metric Overview Cards */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  Available Archives
                </p>
                <p className="text-2xl font-semibold tracking-tight text-slate-900 mt-1 tabular-nums">
                  {backups.length}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                  Total Storage: {totalStorageFormatted}
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EEF2FF] text-[#4F46E5] shrink-0">
                <HardDrive className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  Tamper Verification
                </p>
                <p className="text-2xl font-semibold tracking-tight text-emerald-700 mt-1">
                  SHA-256
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Gzip Level 9 + Companion Hashes
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 shrink-0">
                <ShieldCheck className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  Retention Policy
                </p>
                <p className="text-2xl font-semibold tracking-tight text-slate-900 mt-1 tabular-nums">
                  30 Days
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Min 5 Archives Guarded
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700 shrink-0">
                <Calendar className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  Atomic Restoration
                </p>
                <p className="text-2xl font-semibold tracking-tight text-[#4338CA] mt-1">
                  Active
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Reconstructs 15 Relational Tables
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EEF2FF] text-[#4F46E5] shrink-0">
                <RotateCcw className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Action Controls & Filter Bar */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between bg-white p-3.5 rounded-xl border border-[#E5E7EB]">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => setShowCreateModal(true)}
            >
              <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
              <span>Create Snapshot</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handlePruneBackups}
              disabled={isPruningBackups || backups.length <= 5}
              isLoading={isPruningBackups}
              className="text-amber-700 border-amber-200 hover:bg-amber-50"
              title="Deletes archives older than 30 days while preserving at least 5 newest archives."
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              <span>Apply Retention Prune</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handleVerifyAll}
              disabled={isVerifyingAll || backups.length === 0}
              isLoading={isVerifyingAll}
            >
              <FileCheck2 className="h-3.5 w-3.5 mr-1.5 text-[#4F46E5]" />
              <span>Verify All</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={fetchBackups}
              disabled={isLoading}
              isLoading={isLoading}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:flex-initial">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search archives..."
                className="pl-8 pr-3 h-8 text-xs rounded-lg border border-[#E5E7EB] bg-[#F6F7F9] text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-[#4F46E5] focus:outline-none w-full sm:w-52"
              />
            </div>

            <div className="flex items-center gap-1 bg-[#F6F7F9] border border-[#EAECEF] rounded-lg p-1">
              {[
                { key: "all", label: "All" },
                { key: "verified", label: "Verified" },
                { key: "unverified", label: "Unverified" },
                { key: "issues", label: "Issues" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setStatusFilter(opt.key as "all" | "verified" | "unverified" | "issues")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    statusFilter === opt.key
                      ? "bg-white text-slate-900 shadow-xs border border-[#E5E7EB]/80"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Backups Archives Table */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>Database Snapshot Archives</CardTitle>
              <CardDescription>
                Compressed snapshots stored in authoritative repository with companion SHA-256 digests.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-[11px] font-mono tabular-nums">
              {filteredBackups.length} of {backups.length} archives
            </Badge>
          </CardHeader>

          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
                <RefreshCw className="h-5 w-5 animate-spin text-[#4F46E5]" />
                <p className="text-xs">Loading backup catalog...</p>
              </div>
            ) : filteredBackups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
                <Database className="h-7 w-7 text-slate-300" />
                <p className="text-sm font-medium text-slate-700">
                  No backup archives found
                </p>
                <p className="text-xs text-slate-400">
                  {searchQuery ? "Try refining your search terms." : "Click 'Create Snapshot' to take your first consistent backup."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F6F7F9]/80 border-b border-[#EAECEF] text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-2.5 px-4">Archive Filename</th>
                      <th className="py-2.5 px-4">Created At (EAT)</th>
                      <th className="py-2.5 px-4">Size</th>
                      <th className="py-2.5 px-4">SHA-256 Checksum</th>
                      <th className="py-2.5 px-4">Integrity Status</th>
                      <th className="py-2.5 px-4 text-right">Administrative Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAECEF] text-slate-700">
                    {filteredBackups.map((b) => {
                      const fname = b.filename || b.archive_name || "unknown.json.gz";
                      const sizeDisplay = b.size_kb
                        ? `${b.size_kb} KB`
                        : b.size_bytes
                        ? `${Math.round(b.size_bytes / 1024)} KB`
                        : "N/A";
                      const vResult = verifyResults[fname];
                      const verifyingThis = !!isVerifying[fname];
                      const sha = b.sha256 || vResult?.calculated_sha256;

                      return (
                        <tr key={fname} className="hover:bg-[#F6F7F9]/60 transition-colors">
                          <td className="py-3 px-4 font-mono font-medium text-slate-900">
                            <div className="flex items-center gap-2">
                              <Database className="h-3.5 w-3.5 text-[#4F46E5] shrink-0" />
                              <span className="truncate max-w-[260px]" title={fname}>
                                {fname}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-slate-600 font-mono text-[11px] tabular-nums">
                            {b.created_at
                              ? new Date(b.created_at).toLocaleString("en-US", {
                                  timeZone: "Africa/Addis_Ababa",
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "N/A"}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] tabular-nums">
                            {sizeDisplay}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px]">
                            {sha ? (
                              <div className="flex items-center gap-1.5">
                                <span className="bg-[#F6F7F9] border border-[#EAECEF] px-1.5 py-0.5 rounded text-[10px] text-slate-600">
                                  {sha.substring(0, 12)}...
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyHash(sha)}
                                  className="text-slate-400 hover:text-slate-700 p-0.5"
                                  title="Copy SHA-256 to clipboard"
                                >
                                  {copiedHash === sha ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[10px] italic">No companion hash</span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {verifyingThis ? (
                              <Badge variant="brand" className="text-[10px] animate-pulse">
                                Verifying...
                              </Badge>
                            ) : vResult ? (
                              vResult.valid ? (
                                <Badge variant="success" className="text-[10px] gap-1">
                                  <CheckCircle2 className="h-2.5 w-2.5" />
                                  <span>Verified Intact</span>
                                </Badge>
                              ) : (
                                <Badge variant="danger" className="text-[10px] gap-1" title={vResult.issues?.join("; ") || vResult.error}>
                                  <AlertCircle className="h-2.5 w-2.5" />
                                  <span>Tampered / Corrupted</span>
                                </Badge>
                              )
                            ) : (
                              <Badge variant="outline" className="text-slate-500 text-[10px]">
                                Unverified
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleVerifyBackup(fname)}
                                disabled={verifyingThis}
                                isLoading={verifyingThis}
                                className="h-7 text-[11px] px-2.5"
                              >
                                Verify SHA-256
                              </Button>

                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => handleInitiateRestore(fname)}
                                className="h-7 text-[11px] px-2.5"
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                <span>Restore</span>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Modal: Create Backup Snapshot */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4 border border-[#E5E7EB]">
              <div className="flex items-center justify-between border-b border-[#EAECEF] pb-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-[#4F46E5]" />
                  <h3 className="font-semibold text-slate-900 text-sm sm:text-base">
                    Create Database Snapshot
                  </h3>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-[#F6F7F9] hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleCreateBackup} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    Snapshot Label / Tag *
                  </label>
                  <input
                    type="text"
                    required
                    value={backupLabel}
                    onChange={(e) => setBackupLabel(e.target.value)}
                    placeholder="e.g. pre_payroll_202611, manual_audit_checkpoint"
                    className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-mono focus:border-[#4F46E5] focus:outline-none"
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Label is incorporated into filename (e.g. <code>eipc_backup_20261110_..._manual.json.gz</code>).
                  </p>
                </div>

                <div className="rounded-lg bg-[#EEF2FF]/70 border border-[#C7D2FE] p-3 text-xs text-[#312E81] space-y-1">
                  <p className="font-medium flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-[#4F46E5] shrink-0" />
                    <span>Included Authoritative Entities</span>
                  </p>
                  <p className="text-[11px] text-[#3730A3] leading-relaxed">
                    Atomically packages all 15 relational tables: Employees, Attendance Sessions &amp; Events, Biometric Templates, Shift Rules, Stations, Users, and Audit Logs.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-[#EAECEF]">
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
                    type="submit"
                    variant="primary"
                    size="sm"
                    isLoading={isCreatingBackup}
                  >
                    Generate Snapshot
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: High-Security Disaster Recovery Restoration (Strong Authorization) */}
        {restoreModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-xs">
            <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl space-y-4 border border-rose-200">
              <div className="flex items-center justify-between border-b border-rose-100 pb-3">
                <div className="flex items-center gap-2 text-rose-700">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  <h3 className="font-semibold text-sm sm:text-base">
                    Disaster Recovery: Atomic Database Restoration
                  </h3>
                </div>
                <button
                  onClick={() => setRestoreModal((prev) => ({ ...prev, isOpen: false }))}
                  className="rounded-lg p-1 text-slate-400 hover:bg-[#F6F7F9] hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {restoreModal.error && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-900 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                    <span>Restoration Rejected / Failed</span>
                  </p>
                  <p>{restoreModal.error}</p>
                </div>
              )}

              {restoreModal.report && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-900 space-y-2">
                  <div className="font-semibold flex items-center gap-1.5 text-sm text-emerald-800">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <span>Database Successfully Restored</span>
                  </div>
                  <p className="text-xs tabular-nums">
                    Reconstituted <strong>{restoreModal.report.restored_records || restoreModal.report.total_records_restored || "all"}</strong> relational records. Relational foreign key integrity has been verified. Biometric template memory caches reloaded.
                  </p>
                  {restoreModal.report.relational_integrity && (
                    <div className="bg-white p-2.5 rounded-lg border border-emerald-200 font-mono text-[10px] space-y-1">
                      <p>Integrity Status: {restoreModal.report.relational_integrity.valid ? "PASSED (100% Valid)" : "WARNINGS FOUND"}</p>
                      <p>Schema: {restoreModal.report.relational_integrity.schema_version || "1.0.0-eipc-v1"}</p>
                    </div>
                  )}
                  <p className="text-[11px] text-emerald-800">
                    Audit event <code>DATABASE_BACKUP_RESTORED</code> written to immutable security log.
                  </p>
                </div>
              )}

              {!restoreModal.report && (
                <div className="space-y-4 text-xs text-slate-700">
                  <div className="rounded-xl bg-rose-50/70 border border-rose-200 p-3.5 text-rose-900 space-y-2">
                    <p className="font-semibold">
                      CAUTION: Irreversible Database Overwrite
                    </p>
                    <p className="text-[11px] leading-relaxed">
                      Restoring from this archive replaces all active attendance sessions, punches, employee profiles, shift assignments, and face biometric vectors with the exact state recorded in:
                    </p>
                    <p className="font-mono text-[11px] bg-white p-2 rounded-lg border border-rose-200 text-slate-900 break-all">
                      {restoreModal.filename}
                    </p>
                  </div>

                  {/* Pre-Flight Integrity Indicator */}
                  {restoreModal.filename && (
                    <div className="rounded-lg bg-[#F6F7F9] p-3 border border-[#EAECEF] flex items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-600">
                        Pre-Flight Integrity Check:
                      </span>
                      {verifyResults[restoreModal.filename] ? (
                        verifyResults[restoreModal.filename].valid ? (
                          <Badge variant="success" className="text-[10px]">
                            SHA-256 Verified Intact
                          </Badge>
                        ) : (
                          <Badge variant="danger" className="text-[10px]">
                            Integrity Check Failed
                          </Badge>
                        )
                      ) : (
                        <span className="text-[11px] text-slate-500 italic">Verifying archive...</span>
                      )}
                    </div>
                  )}

                  {/* Strong Authorization Input 1: Explicit Confirmation String */}
                  <div>
                    <label className="text-xs font-medium text-slate-800 block mb-1">
                      1. Type <span className="font-mono text-rose-600 font-semibold">RESTORE</span> in all capital letters to confirm: *
                    </label>
                    <input
                      type="text"
                      required
                      value={restoreModal.confirmText}
                      onChange={(e) => setRestoreModal((prev) => ({ ...prev, confirmText: e.target.value }))}
                      placeholder="Type RESTORE to authorize"
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-mono uppercase focus:border-rose-500 focus:outline-none"
                    />
                  </div>

                  {/* Strong Authorization Input 2: Admin Password Re-Authentication */}
                  <div>
                    <label className="text-xs font-medium text-slate-800 block mb-1">
                      2. Administrator Password (Step-Up Re-Authentication):
                    </label>
                    <input
                      type="password"
                      value={restoreModal.adminPassword}
                      onChange={(e) => setRestoreModal((prev) => ({ ...prev, adminPassword: e.target.value }))}
                      placeholder="Enter administrator password to verify authority"
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs focus:border-rose-500 focus:outline-none"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Protects against unauthorized restorations even if administrative session cookie is active.
                    </p>
                  </div>

                  {/* Strong Authorization Input 3: Mandatory Explicit Acknowledgement */}
                  <div className="flex items-start gap-2.5 pt-1">
                    <input
                      type="checkbox"
                      id="ack-restore-checkbox"
                      checked={restoreModal.acknowledgement}
                      onChange={(e) => setRestoreModal((prev) => ({ ...prev, acknowledgement: e.target.checked }))}
                      className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 h-4 w-4"
                    />
                    <label htmlFor="ack-restore-checkbox" className="text-[11px] text-slate-600 cursor-pointer select-none leading-relaxed">
                      I understand that this action is irreversible and overwrites all attendance, employee, and biometric state with this point-in-time snapshot.
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
                  {restoreModal.report ? "Close Console" : "Cancel"}
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
                    onClick={handleExecuteRestore}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    <span>Authorize &amp; Execute Restoration</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
