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
    </div>
  );
}

