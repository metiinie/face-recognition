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
} from "lucide-react";

export default function AuditReviewPage() {
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [reviewCases, setReviewCases] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>("");

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [logs, cases] = await Promise.all([api.getAuditLogs(100), api.getReviewCases()]);
      setAuditLogs(logs);
      setReviewCases(cases);
    } catch (err) {
      console.error("Failed to load audit logs:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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

        <Button variant="outline" size="sm" onClick={fetchData} isLoading={isLoading}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh Audit Stream
        </Button>
      </div>

      {/* Review Cases Banner */}
      {reviewCases.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/60 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <h4 className="text-xs font-bold text-amber-900">
                {reviewCases.length} Pending Biometric Review Case(s)
              </h4>
              <p className="text-[11px] text-amber-700">
                Unresolved unknown face scans or uncertain match anomalies flagged at kiosk terminals.
              </p>
            </div>
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
    </div>
  );
}

