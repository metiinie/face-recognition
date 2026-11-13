"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AuthGuard } from "@/components/AuthGuard";
import { api, AttendanceSessionRecord } from "@/lib/api";
import { getEntranceSocket } from "@/lib/socket";
import {
  RefreshCw,
  ArrowRight,
  FileText,
  X,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DeptBreakdownRow {
  department: string;
  department_code?: string;
  total_employees: number;
  present: number;
  rate: number;
}

interface HourlyRow {
  hour: string;
  onTime: number;
  late: number;
}

interface SummaryPayload {
  total_employees?: number;
  present_count?: number;
  checkins_count?: number;
  checkouts_count?: number;
  late_count?: number;
  on_time_count?: number;
  open_sessions_count?: number;
  unresolved_reviews?: number;
  hourly_breakdown?: HourlyRow[];
  department_breakdown?: DeptBreakdownRow[];
}

function getEatDateString(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Addis_Ababa",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [liveSessions, setLiveSessions] = useState<AttendanceSessionRecord[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: number; name: string; code: string }>>([]);
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<{ id: number; name: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLiveWs, setIsLiveWs] = useState(false);

  useEffect(() => {
    api
      .getDepartments()
      .then((res) => {
        if (Array.isArray(res)) setDepartments(res);
      })
      .catch((err) => console.error("Failed to load departments:", err));
  }, []);

  const fetchDashboardData = useCallback(async () => {
    setIsLoading(true);
    const todayStr = getEatDateString();
    try {
      const [summaryRes, sessionsRes] = await Promise.all([
        api.getAttendanceSummary(),
        api.getAttendanceSessions({
          date_from: todayStr,
          date_to: todayStr,
          department_id: selectedDeptFilter?.id,
        }),
      ]);
      setSummary(summaryRes as SummaryPayload);
      setLiveSessions((sessionsRes?.sessions || []).slice(0, 12));
    } catch (err) {
      console.error("Failed to load dashboard summary:", err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDeptFilter]);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);

    const socket = getEntranceSocket();
    const onConnect = () => setIsLiveWs(true);
    const onDisconnect = () => setIsLiveWs(false);

    if (socket.connected) {
      setIsLiveWs(true);
    }

    const handleLiveEvent = () => {
      fetchDashboardData();
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("attendance_live_event", handleLiveEvent);

    return () => {
      clearInterval(interval);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("attendance_live_event", handleLiveEvent);
    };
  }, [fetchDashboardData]);

  const defaultHourly: HourlyRow[] = [
    { hour: "06:00", onTime: 0, late: 0 },
    { hour: "07:00", onTime: 0, late: 0 },
    { hour: "08:00", onTime: 0, late: 0 },
    { hour: "09:00", onTime: 0, late: 0 },
    { hour: "10:00", onTime: 0, late: 0 },
    { hour: "11:00", onTime: 0, late: 0 },
    { hour: "12:00", onTime: 0, late: 0 },
    { hour: "13:00", onTime: 0, late: 0 },
    { hour: "14:00", onTime: 0, late: 0 },
    { hour: "15:00", onTime: 0, late: 0 },
    { hour: "16:00", onTime: 0, late: 0 },
    { hour: "17:00", onTime: 0, late: 0 },
    { hour: "18:00", onTime: 0, late: 0 },
  ];

  const hourlyData =
    summary?.hourly_breakdown && summary.hourly_breakdown.length > 0
      ? summary.hourly_breakdown
      : defaultHourly;

  const deptData = [...(summary?.department_breakdown || [])].sort(
    (a, b) => (b.rate ?? 0) - (a.rate ?? 0)
  );

  const totalEmployees = summary?.total_employees ?? 0;
  const presentCount = summary?.present_count ?? 0;
  const onTimeCount = summary?.on_time_count ?? Math.max(0, presentCount - (summary?.late_count ?? 0));
  const lateCount = summary?.late_count ?? 0;
  const openSessions = summary?.open_sessions_count ?? 0;
  const unresolvedReviews = summary?.unresolved_reviews ?? 0;
  const attendanceRate =
    totalEmployees > 0 ? ((presentCount / totalEmployees) * 100).toFixed(1) : "0.0";

  const handleToggleDeptRow = (deptName: string, deptCode?: string) => {
    const matchedDept = departments.find(
      (d) =>
        d.name.toLowerCase() === deptName.toLowerCase() ||
        (deptCode && d.code.toLowerCase() === deptCode.toLowerCase())
    );
    if (!matchedDept) return;
    if (selectedDeptFilter?.id === matchedDept.id) {
      setSelectedDeptFilter(null);
    } else {
      setSelectedDeptFilter({ id: matchedDept.id, name: matchedDept.name });
    }
  };

  return (
    <AuthGuard>
      <div className="space-y-5">
        {/* Top Page Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Attendance Overview
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Daily campus presence, hourly arrival flow, and station telemetry.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium ${
                isLiveWs
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-[#E5E7EB] bg-white text-slate-600"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isLiveWs ? "bg-emerald-500" : "bg-slate-400"
                }`}
              />
              <span>{isLiveWs ? "Live Socket" : "30s Poll"}</span>
            </div>

            <Button variant="outline" size="sm" onClick={fetchDashboardData} isLoading={isLoading}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </Button>

            <Link
              href="/reports"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] px-3 text-xs font-medium text-white transition-colors shadow-[0_1px_2px_rgba(79,70,229,0.2)]"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Reports</span>
            </Link>
          </div>
        </div>

        {/* 4 Clean KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">Total Staff</span>
              <Badge variant="outline" className="text-[10px] font-medium">
                Directory
              </Badge>
            </div>
            <div className="mt-2.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {totalEmployees}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Active enrolled roster</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">Present Today</span>
              <Badge variant="success" className="text-[10px] font-medium tabular-nums">
                {attendanceRate}%
              </Badge>
            </div>
            <div className="mt-2.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {presentCount}
            </div>
            <p className="mt-1 text-[11px] text-slate-400 tabular-nums">
              {onTimeCount} on time · {openSessions} active in campus
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">Late Arrivals</span>
              <Badge variant="warning" className="text-[10px] font-medium">
                15m Grace
              </Badge>
            </div>
            <div className="mt-2.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {lateCount}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Checked in after shift tolerance</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">Review Cases</span>
              <Badge
                variant={unresolvedReviews > 0 ? "danger" : "success"}
                className="text-[10px] font-medium"
              >
                {unresolvedReviews > 0 ? "Action Needed" : "Clear"}
              </Badge>
            </div>
            <div className="mt-2.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {unresolvedReviews}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {unresolvedReviews > 0 ? (
                <Link href="/audit" className="text-[#4F46E5] hover:underline font-medium">
                  Inspect Audit Queue →
                </Link>
              ) : (
                "Zero pending station exceptions"
              )}
            </p>
          </Card>
        </div>

        {/* Analytics Middle Row: Hourly Inflow + Horizontal Dept Rates */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Hourly Inflow */}
          <Card className="lg:col-span-7">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Hourly Scan Inflow</CardTitle>
                <CardDescription>On-time vs late check-in flow by hour (EAT)</CardDescription>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#4F46E5]" />
                  On Time
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#D97706]" />
                  Late
                </span>
              </div>
            </CardHeader>
            <CardContent className="h-64 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hourlyData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="inflowOnTime" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.14} />
                      <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF0F4" />
                  <XAxis
                    dataKey="hour"
                    stroke="#94A3B8"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#94A3B8"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#FFFFFF",
                      borderColor: "#E5E7EB",
                      borderRadius: "8px",
                      fontSize: "12px",
                      boxShadow: "0 2px 6px rgba(15, 23, 42, 0.06)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="onTime"
                    name="On Time"
                    stroke="#4F46E5"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#inflowOnTime)"
                  />
                  <Area
                    type="monotone"
                    dataKey="late"
                    name="Late"
                    stroke="#D97706"
                    strokeWidth={1.75}
                    fillOpacity={0}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Right: Horizontal Department Attendance Rates */}
          <Card className="lg:col-span-5">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Department Rates</CardTitle>
                <CardDescription>Click a department to filter live feed</CardDescription>
              </div>
              {selectedDeptFilter && (
                <button
                  type="button"
                  onClick={() => setSelectedDeptFilter(null)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-[#FAFBFD] px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                >
                  <X className="h-3 w-3" />
                  <span>Reset</span>
                </button>
              )}
            </CardHeader>
            <CardContent className="pt-4">
              {deptData.length > 0 ? (
                <div className="space-y-3.5 max-h-[224px] overflow-y-auto pr-1">
                  {deptData.map((d) => {
                    const pct = Math.min(100, Math.max(0, Number(d.rate ?? 0)));
                    const isSelected =
                      selectedDeptFilter &&
                      selectedDeptFilter.name.toLowerCase() === d.department.toLowerCase();
                    const barColor =
                      pct >= 85
                        ? "bg-[#4F46E5]"
                        : pct >= 60
                        ? "bg-amber-500"
                        : "bg-slate-400";

                    return (
                      <button
                        key={d.department}
                        type="button"
                        onClick={() => handleToggleDeptRow(d.department, d.department_code)}
                        className={`w-full text-left rounded-lg p-1.5 -mx-1.5 transition-colors ${
                          isSelected ? "bg-[#EEF2FF]/70" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs mb-1.5 gap-2">
                          <span className="font-medium text-slate-800 truncate">
                            {d.department}
                            {d.department_code ? (
                              <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                                {d.department_code}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-[11px] font-medium text-slate-600 tabular-nums">
                            {d.present}/{d.total_employees}{" "}
                            <span className="text-slate-900 font-semibold ml-1">{pct.toFixed(0)}%</span>
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-[#F1F3F6] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="h-56 flex items-center justify-center text-xs text-slate-400">
                  No department attendance records yet today.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bottom Live Feed Table */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div>
                <CardTitle>Live Attendance Feed</CardTitle>
                <CardDescription>Most recent verified staff sessions recorded today</CardDescription>
              </div>
              {selectedDeptFilter && (
                <Badge variant="brand" className="gap-1">
                  <span>{selectedDeptFilter.name}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedDeptFilter(null)}
                    aria-label="Clear department filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </div>
            <Link
              href="/reports"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#4F46E5] hover:text-[#4338CA]"
            >
              <span>View All Reports</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#EAECEF] bg-[#FAFBFD] text-[10.5px] font-medium uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-2.5 px-5">Employee</th>
                  <th className="py-2.5 px-4">Department</th>
                  <th className="py-2.5 px-4">Shift</th>
                  <th className="py-2.5 px-4">Check-In</th>
                  <th className="py-2.5 px-4">Check-Out</th>
                  <th className="py-2.5 px-4">Method</th>
                  <th className="py-2.5 px-5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAECEF]">
                {liveSessions.map((s) => {
                  const initials = s.employee_name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  return (
                    <tr key={s.id} className="hover:bg-[#FAFBFD] transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-700 border border-[#E5E7EB]">
                            {initials}
                          </div>
                          <div>
                            <div className="font-medium text-slate-900">{s.employee_name}</div>
                            <div className="text-[11px] text-slate-400 font-mono">{s.employee_number}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        <div>{s.department_name}</div>
                        <div className="text-[11px] text-slate-400">{s.job_category}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px] tabular-nums whitespace-nowrap">
                        {s.shift_start_eat?.split(" ")[1] || s.shift_start_eat} –{" "}
                        {s.shift_end_eat?.split(" ")[1] || s.shift_end_eat}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] tabular-nums whitespace-nowrap">
                        {s.check_in ? (
                          <div>
                            <span className="font-medium text-slate-900">{s.check_in.time_eat}</span>
                            <div className="text-[10px] text-slate-400">{s.check_in.station_code}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] tabular-nums whitespace-nowrap">
                        {s.check_out ? (
                          <div>
                            <span className="font-medium text-slate-900">{s.check_out.time_eat}</span>
                            <div className="text-[10px] text-slate-400">{s.check_out.station_code}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">Open</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={s.check_in?.capture_method === "MANUAL_HR" ? "warning" : "outline"}
                          className="text-[10px]"
                        >
                          {s.check_in?.capture_method === "MANUAL_HR" ? "Manual HR" : "Biometric"}
                        </Badge>
                      </td>
                      <td className="py-3 px-5 text-right">
                        {s.arrival_status === "ON_TIME" ? (
                          <Badge variant="success">On Time</Badge>
                        ) : (
                          <Badge variant="danger">Late · {s.late_minutes}m</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {liveSessions.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-xs text-slate-400">
                      No check-ins recorded yet today{selectedDeptFilter ? ` in ${selectedDeptFilter.name}` : ""}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AuthGuard>
  );
}
