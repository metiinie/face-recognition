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
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-6">
        {/* Header with Title and Administrative Scope */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-5 border-slate-200 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                  Disaster Recovery & Database Backups
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Institutional point-in-time snapshots, SHA-256 cryptographic verification, automated retention, and audited restoration.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-blue-300 bg-blue-50/70 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 font-mono text-[11px] px-2.5 py-1">
              Role: System Administrator
            </Badge>
            <Link
              href="/audit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
              <span>Audit Trail</span>
            </Link>
          </div>
        </div>

        {/* Global Feedback Banner */}
        {actionMessage && (
          <div
            className={`flex items-center justify-between rounded-xl p-3.5 text-xs border ${
              actionMessage.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200"
                : actionMessage.type === "error"
                ? "bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200"
                : "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {actionMessage.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
              {actionMessage.type === "error" && <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />}
              {actionMessage.type === "info" && <RefreshCw className="h-4 w-4 text-blue-600 animate-spin shrink-0" />}
              <span>{actionMessage.text}</span>
            </div>
            <button
              onClick={() => setActionMessage(null)}
              className="text-slate-400 hover:text-slate-600 p-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Top 4 Metric Overview Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Available Archives
                </p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                  {backups.length}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Total Storage: {totalStorageFormatted}
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                <HardDrive className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Tamper Verification
                </p>
                <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
                  SHA-256
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Gzip Level 9 + Companion Hashes
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Retention Policy
                </p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                  30 Days
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Min 5 Archives Guarded
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
                <Calendar className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Atomic Restoration
                </p>
                <p className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
                  Active
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Reconstructs 15 Relational Tables
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                <RotateCcw className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Action Controls & Filter Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
              onClick={() => setShowCreateModal(true)}
            >
              <PlusCircle className="h-4 w-4 mr-1.5" />
              <span>Create Snapshot</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handlePruneBackups}
              disabled={isPruningBackups || backups.length <= 5}
              isLoading={isPruningBackups}
              className="text-amber-700 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800"
              title="Deletes archives older than 30 days while preserving at least 5 newest archives."
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              <span>Apply Retention Prune</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handleVerifyAll}
              disabled={isVerifyingAll || backups.length === 0}
              isLoading={isVerifyingAll}
              className="text-slate-700 dark:text-slate-200"
            >
              <FileCheck2 className="h-4 w-4 mr-1.5 text-blue-500" />
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
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search archives..."
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 w-44 sm:w-52"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 dark:text-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Statuses</option>
              <option value="verified">Verified Intact</option>
              <option value="unverified">Unverified</option>
              <option value="issues">Tampered / Issues</option>
            </select>
          </div>
        </div>

        {/* Backups Archives Table */}
        <Card className="border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <CardHeader className="border-b border-slate-100 p-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold text-slate-900 dark:text-white">
                  Database Snapshot Archives
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                  Compressed snapshots stored in authoritative repository with companion SHA-256 digests.
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-[11px] font-mono">
                {filteredBackups.length} of {backups.length} archives
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
                <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
                <p className="text-xs">Loading backup catalog...</p>
              </div>
            ) : filteredBackups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
                <Database className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                  No backup archives found
                </p>
                <p className="text-xs text-slate-400">
                  {searchQuery ? "Try refining your search terms." : "Click 'Create Snapshot' to take your first consistent backup."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 dark:bg-slate-800/60 dark:border-slate-800 font-semibold">
                    <tr>
                      <th className="py-3 px-4">Archive Filename</th>
                      <th className="py-3 px-4">Created At (EAT)</th>
                      <th className="py-3 px-4">Size</th>
                      <th className="py-3 px-4">SHA-256 Checksum</th>
                      <th className="py-3 px-4">Integrity Status</th>
                      <th className="py-3 px-4 text-right">Administrative Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
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
                        <tr key={fname} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <Database className="h-4 w-4 text-blue-500 shrink-0" />
                              <span className="truncate max-w-[260px]" title={fname}>
                                {fname}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400 font-mono text-[11px]">
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
                          <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px]">
                            {sizeDisplay}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px]">
                            {sha ? (
                              <div className="flex items-center gap-1.5">
                                <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-slate-600 dark:text-slate-300">
                                  {sha.substring(0, 12)}...
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyHash(sha)}
                                  className="text-slate-400 hover:text-slate-600 p-0.5"
                                  title="Copy SHA-256 to clipboard"
                                >
                                  {copiedHash === sha ? (
                                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[10px] italic">No companion hash</span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {verifyingThis ? (
                              <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 text-[10px] animate-pulse">
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
                                className="h-7 text-[11px] px-2"
                              >
                                Verify SHA-256
                              </Button>

                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => handleInitiateRestore(fname)}
                                className="h-7 text-[11px] px-2 bg-rose-600 hover:bg-rose-700 text-white font-medium"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
              <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-blue-600" />
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base">
                    Create Database Snapshot
                  </h3>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleCreateBackup} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Snapshot Label / Tag *
                  </label>
                  <input
                    type="text"
                    required
                    value={backupLabel}
                    onChange={(e) => setBackupLabel(e.target.value)}
                    placeholder="e.g. pre_payroll_202611, manual_audit_checkpoint"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none dark:text-white"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Label is incorporated into filename (e.g. <code>eipc_backup_20261110_..._manual.json.gz</code>).
                  </p>
                </div>

                <div className="rounded-lg bg-blue-50/70 border border-blue-200 dark:bg-blue-950/40 dark:border-blue-900 p-3 text-xs text-blue-900 dark:text-blue-200 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                    <span>Included Authoritative Entities</span>
                  </p>
                  <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
                    Atomically packages all 15 relational tables: Employees, Attendance Sessions & Events, Biometric Templates, Shift Rules, Stations, Users, and Audit Logs.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
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
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-4 border-2 border-rose-300 dark:bg-slate-900 dark:border-rose-900">
              <div className="flex items-center justify-between border-b border-rose-100 pb-3 dark:border-rose-900/50">
                <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  <h3 className="font-bold text-sm sm:text-base">
                    Disaster Recovery: Atomic Database Restoration
                  </h3>
                </div>
                <button
                  onClick={() => setRestoreModal((prev) => ({ ...prev, isOpen: false }))}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {restoreModal.error && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                    <span>Restoration Rejected / Failed</span>
                  </p>
                  <p>{restoreModal.error}</p>
                </div>
              )}

              {restoreModal.report && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200 space-y-2">
                  <div className="font-bold flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <span>Database Successfully Restored!</span>
                  </div>
                  <p className="text-xs">
                    Reconstituted <strong>{restoreModal.report.restored_records || restoreModal.report.total_records_restored || "all"}</strong> relational records. Relational foreign key integrity has been verified. Biometric template memory caches reloaded.
                  </p>
                  {restoreModal.report.relational_integrity && (
                    <div className="bg-white/80 dark:bg-slate-800 p-2.5 rounded-lg border border-emerald-300 font-mono text-[10px] space-y-1">
                      <p>Integrity Status: {restoreModal.report.relational_integrity.valid ? "PASSED (100% Valid)" : "WARNINGS FOUND"}</p>
                      <p>Schema: {restoreModal.report.relational_integrity.schema_version || "1.0.0-eipc-v1"}</p>
                    </div>
                  )}
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                    Audit event <code>DATABASE_BACKUP_RESTORED</code> written to immutable security log.
                  </p>
                </div>
              )}

              {!restoreModal.report && (
                <div className="space-y-4 text-xs text-slate-700 dark:text-slate-300">
                  <div className="rounded-xl bg-rose-50/70 border border-rose-200 dark:bg-rose-950/30 dark:border-rose-900 p-3.5 text-rose-900 dark:text-rose-200 space-y-2">
                    <p className="font-bold">
                      CAUTION: Irreversible Database Overwrite
                    </p>
                    <p className="text-[11px] leading-relaxed">
                      Restoring from this archive replaces all active attendance sessions, punches, employee profiles, shift assignments, and face biometric vectors with the exact state recorded in:
                    </p>
                    <p className="font-mono text-[11px] bg-white dark:bg-slate-800 p-2 rounded-lg border border-rose-200 dark:border-rose-800 text-slate-900 dark:text-white break-all">
                      {restoreModal.filename}
                    </p>
                  </div>

                  {/* Pre-Flight Integrity Indicator */}
                  {restoreModal.filename && (
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
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
                    <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 block mb-1">
                      1. Type <span className="font-mono text-rose-600 font-bold">RESTORE</span> in all capital letters to confirm: *
                    </label>
                    <input
                      type="text"
                      required
                      value={restoreModal.confirmText}
                      onChange={(e) => setRestoreModal((prev) => ({ ...prev, confirmText: e.target.value }))}
                      placeholder="Type RESTORE to authorize"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs font-mono uppercase focus:ring-1 focus:ring-rose-500 focus:outline-none dark:text-white"
                    />
                  </div>

                  {/* Strong Authorization Input 2: Admin Password Re-Authentication */}
                  <div>
                    <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 block mb-1">
                      2. Administrator Password (Step-Up Re-Authentication):
                    </label>
                    <input
                      type="password"
                      value={restoreModal.adminPassword}
                      onChange={(e) => setRestoreModal((prev) => ({ ...prev, adminPassword: e.target.value }))}
                      placeholder="Enter administrator password to verify authority"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs focus:ring-1 focus:ring-rose-500 focus:outline-none dark:text-white"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
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
                    <label htmlFor="ack-restore-checkbox" className="text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer select-none leading-relaxed">
                      I understand that this action is irreversible and overwrites all attendance, employee, and biometric state with this point-in-time snapshot.
                    </label>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
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
                    className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    <span>Authorize & Execute Restoration</span>
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
