"use client";

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AuthGuard } from "@/components/AuthGuard";
import {
  api,
  ShiftTemplateRecord,
  ShiftAssignmentRecord,
  ScheduleExceptionRecord,
  StationRecord,
  PolicySignoffRecord,
  EmployeeRecord,
} from "@/lib/api";
import {
  CalendarClock,
  Clock,
  Calendar,
  ShieldCheck,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  Users,
  Radio,
  FileCheck2,
} from "lucide-react";

// Helper for live Ethiopian clock display from 24h EAT
function calculateEthiopianClock(timeStr: string): string {
  if (!timeStr || !timeStr.includes(":")) return "--:--";
  try {
    const [hStr, mStr] = timeStr.split(":");
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (isNaN(h) || isNaN(m)) return "--:--";

    let ethHour: number;
    let cycle = "";

    if (h >= 6 && h < 18) {
      // Day cycle (Ken)
      ethHour = h - 6;
      if (ethHour === 0) ethHour = 12;
      cycle = "Qen (Day)";
    } else {
      // Night cycle (Maita)
      ethHour = h >= 18 ? h - 18 : h + 6;
      if (ethHour === 0) ethHour = 12;
      cycle = "Maita (Night)";
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(ethHour)}:${pad(m)} ${cycle}`;
  } catch {
    return timeStr;
  }
}

export default function SchedulesStationsPage() {
  const [activeTab, setActiveTab] = useState<"templates" | "assignments" | "exceptions" | "stations" | "policies">("templates");
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Data collections
  const [templates, setTemplates] = useState<ShiftTemplateRecord[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignmentRecord[]>([]);
  const [exceptions, setExceptions] = useState<ScheduleExceptionRecord[]>([]);
  const [stations, setStations] = useState<StationRecord[]>([]);
  const [policies, setPolicies] = useState<PolicySignoffRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: number; name: string; code: string }>>([]);

  // Create Shift Form State
  const [newShift, setNewShift] = useState({
    name: "",
    job_category: "REGULAR_STAFF",
    start_time: "08:00",
    end_time: "17:00",
    grace_period_minutes: 15,
    spans_midnight: false,
    is_24_hour: false,
    break_rules: "60 min lunch break",
    hr_approved: true,
  });

  // Assign Shift Form State
  const [newAssignment, setNewAssignment] = useState({
    employee_id: "",
    shift_template_id: "",
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: "",
    working_days: "0,1,2,3,4",
  });

  // Exception Form State
  const [newException, setNewException] = useState({
    title: "",
    exception_type: "PUBLIC_HOLIDAY",
    employee_id: "",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    reason: "",
  });

  // Station Registration Form State
  const [newStation, setNewStation] = useState({
    station_code: "",
    name: "",
    department_id: "",
    location: "",
  });

  const fetchData = async () => {
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const [tmplRes, assignRes, excRes, stRes, polRes, empRes, deptRes] = await Promise.all([
        api.getShiftTemplates(),
        api.getShiftAssignments(),
        api.getScheduleExceptions(),
        api.getStations(),
        api.getPolicies(),
        api.getEmployees(),
        api.getDepartments(),
      ]);

      setTemplates(tmplRes);
      setAssignments(assignRes);
      setExceptions(excRes);
      setStations(stRes);
      setPolicies(polRes);
      setEmployees(empRes);
      setDepartments(deptRes);

      if (tmplRes.length > 0 && !newAssignment.shift_template_id) {
        setNewAssignment((prev) => ({ ...prev, shift_template_id: String(tmplRes[0].id) }));
      }
      if (empRes.length > 0 && !newAssignment.employee_id) {
        setNewAssignment((prev) => ({ ...prev, employee_id: String(empRes[0].id) }));
      }
      if (deptRes.length > 0 && !newStation.department_id) {
        setNewStation((prev) => ({ ...prev, department_id: String(deptRes[0].id) }));
      }
    } catch (err: any) {
      console.error("Failed to load schedule and station data:", err);
      setStatusMessage({ type: "error", text: "Failed to load records from backend server." });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Form Handlers
  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createShiftTemplate({
        ...newShift,
        grace_period_minutes: Number(newShift.grace_period_minutes),
      });
      setStatusMessage({ type: "success", text: `Shift template '${newShift.name}' successfully created.` });
      setNewShift({
        name: "",
        job_category: "REGULAR_STAFF",
        start_time: "08:00",
        end_time: "17:00",
        grace_period_minutes: 15,
        spans_midnight: false,
        is_24_hour: false,
        break_rules: "60 min lunch break",
        hr_approved: true,
      });
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Failed to create shift template." });
    }
  };

  const handleAssignShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssignment.employee_id || !newAssignment.shift_template_id) return;
    try {
      await api.assignShift({
        employee_id: Number(newAssignment.employee_id),
        shift_template_id: Number(newAssignment.shift_template_id),
        effective_from: newAssignment.effective_from,
        effective_to: newAssignment.effective_to || null,
        working_days: newAssignment.working_days,
      });
      setStatusMessage({ type: "success", text: "Shift schedule assigned successfully without rewriting historical logs (AT-19)." });
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Failed to assign shift schedule." });
    }
  };

  const handleCreateException = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createScheduleException({
        title: newException.title,
        exception_type: newException.exception_type,
        start_date: newException.start_date,
        end_date: newException.end_date,
        employee_id: newException.employee_id ? Number(newException.employee_id) : null,
        reason: newException.reason,
      });
      setStatusMessage({ type: "success", text: `Holiday/leave exception '${newException.title}' recorded (AT-20).` });
      setNewException({
        title: "",
        exception_type: "PUBLIC_HOLIDAY",
        employee_id: "",
        start_date: new Date().toISOString().slice(0, 10),
        end_date: new Date().toISOString().slice(0, 10),
        reason: "",
      });
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Failed to create exception." });
    }
  };

  const handleCreateStation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStation.station_code || !newStation.name || !newStation.department_id) return;
    try {
      await api.createStation({
        station_code: newStation.station_code,
        name: newStation.name,
        department_id: Number(newStation.department_id),
        location: newStation.location,
      });
      setStatusMessage({ type: "success", text: `Departmental station '${newStation.station_code}' registered (AT-22, AT-24).` });
      setNewStation({ station_code: "", name: "", department_id: departments[0]?.id ? String(departments[0].id) : "", location: "" });
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Failed to register station." });
    }
  };

  const handleConfirmPolicy = async (policyId: number) => {
    try {
      await api.updatePolicy(policyId, {
        status: "CONFIRMED",
        decision_notes: "Confirmed and approved for college deployment.",
      });
      setStatusMessage({ type: "success", text: "Policy sign-off updated and audited." });
      fetchData();
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Failed to update policy sign-off." });
    }
  };

  return (
    <AuthGuard>
      <div className="space-y-6 pb-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EAECEF] pb-5">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
              Schedules, Shifts &amp; Stations
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Configure shift templates with Ethiopian-Clock mapping, assign staff schedules, manage leaves, and register terminals.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} isLoading={isLoading}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>

        {/* Status banner */}
        {statusMessage && (
          <div
            className={`px-4 py-3 rounded-xl border text-xs flex items-center justify-between ${
              statusMessage.type === "success"
                ? "bg-emerald-50/80 text-emerald-800 border-emerald-200"
                : "bg-rose-50/80 text-rose-800 border-rose-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {statusMessage.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-xs font-medium hover:underline ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* KPI Tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Shift Templates
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
                  {templates.length}
                </p>
              </div>
              <div className="h-9 w-9 rounded-lg bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center shrink-0">
                <CalendarClock className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Active Assignments
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
                  {assignments.length}
                </p>
              </div>
              <div className="h-9 w-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <Users className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Registered Stations
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
                  {stations.length}
                </p>
              </div>
              <div className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <Radio className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Confirmed Policies
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
                  {policies.filter((p) => p.status === "CONFIRMED").length} / {policies.length}
                </p>
              </div>
              <div className="h-9 w-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <FileCheck2 className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Segmented Tabs */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-1.5 flex items-center overflow-x-auto gap-1">
          <button
            onClick={() => setActiveTab("templates")}
            className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === "templates"
                ? "bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-[#F6F7F9]"
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            Shift Templates &amp; Ethiopian Clock (AT-15..18)
          </button>

          <button
            onClick={() => setActiveTab("assignments")}
            className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === "assignments"
                ? "bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-[#F6F7F9]"
            }`}
          >
            <Briefcase className="h-3.5 w-3.5" />
            Effective Assignments (AT-19)
          </button>

          <button
            onClick={() => setActiveTab("exceptions")}
            className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === "exceptions"
                ? "bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-[#F6F7F9]"
            }`}
          >
            <Calendar className="h-3.5 w-3.5" />
            Holidays &amp; Leaves (AT-20)
          </button>

          <button
            onClick={() => setActiveTab("stations")}
            className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === "stations"
                ? "bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-[#F6F7F9]"
            }`}
          >
            <Radio className="h-3.5 w-3.5" />
            Attendance Stations &amp; Tokens (AT-22, 24)
          </button>

          <button
            onClick={() => setActiveTab("policies")}
            className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === "policies"
                ? "bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-[#F6F7F9]"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Section 8 Policy Sign-Offs
          </button>
        </div>

        {/* Tab 1: Shift Templates */}
        {activeTab === "templates" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Create Shift Template Form */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-4 w-4 text-[#4F46E5]" /> Create Shift Template
                </CardTitle>
                <CardDescription>
                  Supports regular staff, sanitation and 24h guards (AT-15..AT-18).
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleCreateShift} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Shift Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Afternoon Workshop Shift"
                      value={newShift.name}
                      onChange={(e) => setNewShift({ ...newShift, name: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Job Category *</label>
                    <select
                      value={newShift.job_category}
                      onChange={(e) => setNewShift({ ...newShift, job_category: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    >
                      <option value="REGULAR_STAFF">REGULAR_STAFF</option>
                      <option value="CLEANING_STAFF">CLEANING_STAFF</option>
                      <option value="SECURITY_GUARD">SECURITY_GUARD</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Start Time (24h EAT) *</label>
                      <input
                        type="time"
                        required
                        value={newShift.start_time}
                        onChange={(e) => setNewShift({ ...newShift, start_time: e.target.value })}
                        className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 tabular-nums focus:border-[#4F46E5] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">End Time (24h EAT) *</label>
                      <input
                        type="time"
                        required
                        value={newShift.end_time}
                        onChange={(e) => setNewShift({ ...newShift, end_time: e.target.value })}
                        className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 tabular-nums focus:border-[#4F46E5] focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Live Ethiopian Clock Translation Preview */}
                  <div className="rounded-lg bg-[#F6F7F9] border border-[#EAECEF] p-3 text-[11px] text-slate-700">
                    <div className="flex items-center gap-1.5 font-medium text-slate-700 mb-1">
                      <Clock className="h-3.5 w-3.5 text-[#4F46E5]" />
                      Ethiopian Clock Translation Preview (AT-16):
                    </div>
                    <div className="font-mono text-xs font-medium text-slate-900 tabular-nums">
                      {calculateEthiopianClock(newShift.start_time)} → {calculateEthiopianClock(newShift.end_time)}
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Grace Period (Minutes)</label>
                    <input
                      type="number"
                      min="0"
                      max="120"
                      value={newShift.grace_period_minutes}
                      onChange={(e) => setNewShift({ ...newShift, grace_period_minutes: Number(e.target.value) })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs text-slate-900 tabular-nums focus:border-[#4F46E5] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Break Rules</label>
                    <input
                      type="text"
                      value={newShift.break_rules}
                      onChange={(e) => setNewShift({ ...newShift, break_rules: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    />
                  </div>

                  <div className="space-y-2.5 pt-2 border-t border-[#EAECEF]">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newShift.spans_midnight}
                        onChange={(e) => setNewShift({ ...newShift, spans_midnight: e.target.checked })}
                        className="rounded border-slate-300 text-[#4F46E5] focus:ring-[#4F46E5]"
                      />
                      <span className="text-slate-700 font-medium">Overnight Shift Spans Midnight (AT-17)</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newShift.is_24_hour}
                        onChange={(e) => setNewShift({ ...newShift, is_24_hour: e.target.checked })}
                        className="rounded border-slate-300 text-[#4F46E5] focus:ring-[#4F46E5]"
                      />
                      <span className="text-slate-700 font-medium">24-Hour Guard Shift (+1 Day Window, AT-18)</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newShift.hr_approved}
                        onChange={(e) => setNewShift({ ...newShift, hr_approved: e.target.checked })}
                        className="rounded border-slate-300 text-[#4F46E5] focus:ring-[#4F46E5]"
                      />
                      <span className="text-slate-700 font-medium">HR Approved Ethiopian Translation</span>
                    </label>
                  </div>

                  <Button type="submit" className="w-full" size="sm">
                    Save Shift Template
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Configured Shift Templates Table */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle>Configured Shift Templates &amp; Ethiopian Time</CardTitle>
                  <CardDescription>
                    Active schedules across academic, administrative, and security departments.
                  </CardDescription>
                </div>
                <Badge variant="brand">{templates.length} Active</Badge>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#F6F7F9]/80 text-slate-500 uppercase tracking-wider text-[10px] border-b border-[#EAECEF]">
                      <tr>
                        <th className="py-2.5 px-3.5 font-semibold">Shift Name</th>
                        <th className="py-2.5 px-3.5 font-semibold">Category</th>
                        <th className="py-2.5 px-3.5 font-semibold">24h EAT</th>
                        <th className="py-2.5 px-3.5 font-semibold">Ethiopian Clock Equivalent</th>
                        <th className="py-2.5 px-3.5 font-semibold">Grace</th>
                        <th className="py-2.5 px-3.5 font-semibold">Type</th>
                        <th className="py-2.5 px-3.5 font-semibold">HR Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAECEF]">
                      {templates.map((t) => (
                        <tr key={t.id} className="hover:bg-[#F6F7F9]/60 transition-colors">
                          <td className="py-2.5 px-3.5 font-medium text-slate-900">{t.name}</td>
                          <td className="py-2.5 px-3.5">
                            <span className="rounded bg-[#F6F7F9] border border-[#EAECEF] px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
                              {t.job_category}
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-slate-600 tabular-nums">
                            {t.start_time} - {t.end_time}
                          </td>
                          <td className="py-2.5 px-3.5">
                            <Badge variant="brand" className="text-[10px] font-mono tabular-nums">
                              {t.ethiopian_display}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-600 tabular-nums">{t.grace_period_minutes}m</td>
                          <td className="py-2.5 px-3.5">
                            {t.is_24_hour ? (
                              <Badge variant="warning" className="text-[10px]">24-Hour (+1d)</Badge>
                            ) : t.spans_midnight ? (
                              <Badge variant="warning" className="text-[10px]">Overnight (+1d)</Badge>
                            ) : (
                              <span className="text-slate-400">Standard</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5">
                            {t.hr_approved ? (
                              <Badge variant="success" className="text-[10px]">Approved</Badge>
                            ) : (
                              <Badge variant="danger" className="text-[10px]">Pending</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab 2: Effective Assignments */}
        {activeTab === "assignments" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Assignment Form */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-[#4F46E5]" /> Assign Employee Schedule
                </CardTitle>
                <CardDescription>
                  Effective-dated transition preserves prior attendance history (AT-19).
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleAssignShift} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Employee *</label>
                    <select
                      required
                      value={newAssignment.employee_id}
                      onChange={(e) => setNewAssignment({ ...newAssignment, employee_id: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    >
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.employee_number} — {emp.first_name} {emp.last_name} ({emp.job_category})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Shift Template *</label>
                    <select
                      required
                      value={newAssignment.shift_template_id}
                      onChange={(e) => setNewAssignment({ ...newAssignment, shift_template_id: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    >
                      {templates.map((tmpl) => (
                        <option key={tmpl.id} value={tmpl.id}>
                          {tmpl.name} [{tmpl.ethiopian_display}]
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Effective From *</label>
                    <input
                      type="date"
                      required
                      value={newAssignment.effective_from}
                      onChange={(e) => setNewAssignment({ ...newAssignment, effective_from: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 tabular-nums focus:border-[#4F46E5] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Effective To (Optional)</label>
                    <input
                      type="date"
                      value={newAssignment.effective_to}
                      onChange={(e) => setNewAssignment({ ...newAssignment, effective_to: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 tabular-nums focus:border-[#4F46E5] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Working Days (0=Mon..6=Sun)</label>
                    <input
                      type="text"
                      value={newAssignment.working_days}
                      onChange={(e) => setNewAssignment({ ...newAssignment, working_days: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs text-slate-900 font-mono focus:border-[#4F46E5] focus:outline-none"
                    />
                  </div>

                  <Button type="submit" className="w-full" size="sm">
                    Assign Schedule (AT-19)
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Assignments List */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle>Effective-Dated Employee Schedules</CardTitle>
                  <CardDescription>
                    Schedule changes apply strictly from their effective dates without retroactive mutation.
                  </CardDescription>
                </div>
                <Badge variant="brand">{assignments.length} Records</Badge>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#F6F7F9]/80 text-slate-500 uppercase tracking-wider text-[10px] border-b border-[#EAECEF]">
                      <tr>
                        <th className="py-2.5 px-3.5 font-semibold">Employee</th>
                        <th className="py-2.5 px-3.5 font-semibold">Shift Template</th>
                        <th className="py-2.5 px-3.5 font-semibold">Ethiopian Window</th>
                        <th className="py-2.5 px-3.5 font-semibold">Effective Range</th>
                        <th className="py-2.5 px-3.5 font-semibold">Workdays</th>
                        <th className="py-2.5 px-3.5 font-semibold">Approved By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAECEF]">
                      {assignments.map((a) => (
                        <tr key={a.id} className="hover:bg-[#F6F7F9]/60 transition-colors">
                          <td className="py-2.5 px-3.5">
                            <p className="font-medium text-slate-900">{a.employee_name}</p>
                            <p className="text-[10px] font-mono text-slate-500">{a.employee_number}</p>
                          </td>
                          <td className="py-2.5 px-3.5 font-medium text-slate-700">{a.shift_name}</td>
                          <td className="py-2.5 px-3.5">
                            <Badge variant="brand" className="text-[10px] font-mono tabular-nums">
                              {a.ethiopian_display}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-slate-600 tabular-nums">
                            {a.effective_from} → {a.effective_to || "Open-ended"}
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-500 font-mono text-[11px]">{a.working_days}</td>
                          <td className="py-2.5 px-3.5 text-slate-500">{a.approved_by}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab 3: Holidays & Leaves */}
        {activeTab === "exceptions" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Create Exception Form */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-emerald-600" /> Record Holiday or Leave (AT-20)
                </CardTitle>
                <CardDescription>
                  Exempts scheduled shifts on public holidays or approved employee leaves.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleCreateException} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Title / Description *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Adwa Victory Day / Approved Medical Leave"
                      value={newException.title}
                      onChange={(e) => setNewException({ ...newException, title: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Exception Type *</label>
                    <select
                      value={newException.exception_type}
                      onChange={(e) => setNewException({ ...newException, exception_type: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    >
                      <option value="PUBLIC_HOLIDAY">PUBLIC_HOLIDAY (College-Wide)</option>
                      <option value="APPROVED_LEAVE">APPROVED_LEAVE (Individual Staff)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Employee (Leave blank for College-Wide Holiday)
                    </label>
                    <select
                      value={newException.employee_id}
                      onChange={(e) => setNewException({ ...newException, employee_id: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    >
                      <option value="">-- All College Staff --</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.employee_number} — {emp.first_name} {emp.last_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Start Date *</label>
                      <input
                        type="date"
                        required
                        value={newException.start_date}
                        onChange={(e) => setNewException({ ...newException, start_date: e.target.value })}
                        className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 tabular-nums focus:border-[#4F46E5] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">End Date *</label>
                      <input
                        type="date"
                        required
                        value={newException.end_date}
                        onChange={(e) => setNewException({ ...newException, end_date: e.target.value })}
                        className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 tabular-nums focus:border-[#4F46E5] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Reason / Notes</label>
                    <input
                      type="text"
                      placeholder="e.g. Gazetted National Holiday"
                      value={newException.reason}
                      onChange={(e) => setNewException({ ...newException, reason: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    />
                  </div>

                  <Button type="submit" variant="success" className="w-full" size="sm">
                    Add Approved Exception
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Exceptions Table */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle>Configured Exceptions &amp; Leaves</CardTitle>
                  <CardDescription>
                    Days exempted from absence penalties and overdue flags.
                  </CardDescription>
                </div>
                <Badge variant="brand">{exceptions.length} Configured</Badge>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#F6F7F9]/80 text-slate-500 uppercase tracking-wider text-[10px] border-b border-[#EAECEF]">
                      <tr>
                        <th className="py-2.5 px-3.5 font-semibold">Title</th>
                        <th className="py-2.5 px-3.5 font-semibold">Type</th>
                        <th className="py-2.5 px-3.5 font-semibold">Scope</th>
                        <th className="py-2.5 px-3.5 font-semibold">Dates</th>
                        <th className="py-2.5 px-3.5 font-semibold">Reason</th>
                        <th className="py-2.5 px-3.5 font-semibold">Approved By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAECEF]">
                      {exceptions.map((ex) => (
                        <tr key={ex.id} className="hover:bg-[#F6F7F9]/60 transition-colors">
                          <td className="py-2.5 px-3.5 font-medium text-slate-900">{ex.title}</td>
                          <td className="py-2.5 px-3.5">
                            <Badge variant="brand" className="text-[10px]">{ex.exception_type}</Badge>
                          </td>
                          <td className="py-2.5 px-3.5">
                            {ex.employee_id ? (
                              <span className="font-mono text-slate-600">{ex.employee_name} ({ex.employee_number})</span>
                            ) : (
                              <span className="rounded bg-[#F6F7F9] border border-[#EAECEF] px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                                ALL COLLEGE STAFF
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-slate-600 tabular-nums">
                            {ex.start_date} → {ex.end_date}
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-500">{ex.reason || "—"}</td>
                          <td className="py-2.5 px-3.5 text-slate-500">{ex.approved_by}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab 4: Departmental Stations */}
        {activeTab === "stations" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Station Registration Form */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-[#4F46E5]" /> Register Department Station
                </CardTitle>
                <CardDescription>
                  Creates trusted station credentials and secret tokens (AT-22, AT-24).
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleCreateStation} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Station Code *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. ST-ELECT-01"
                      value={newStation.station_code}
                      onChange={(e) => setNewStation({ ...newStation, station_code: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none uppercase font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Station Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Electrical Dept Kiosk"
                      value={newStation.name}
                      onChange={(e) => setNewStation({ ...newStation, name: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Assigned Department *</label>
                    <select
                      required
                      value={newStation.department_id}
                      onChange={(e) => setNewStation({ ...newStation, department_id: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    >
                      {departments.map((dept) => (
                        <option key={dept.id} value={dept.id}>
                          {dept.code} — {dept.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Physical Location *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Building D Workshop Entrance"
                      value={newStation.location}
                      onChange={(e) => setNewStation({ ...newStation, location: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                    />
                  </div>

                  <Button type="submit" className="w-full" size="sm">
                    Register Departmental Station
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Stations Table */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle>Registered Departmental Attendance Stations</CardTitle>
                  <CardDescription>
                    Trusted hardware devices and browser terminals cryptographically verified via station tokens.
                  </CardDescription>
                </div>
                <Badge variant="brand">{stations.length} Registered</Badge>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#F6F7F9]/80 text-slate-500 uppercase tracking-wider text-[10px] border-b border-[#EAECEF]">
                      <tr>
                        <th className="py-2.5 px-3.5 font-semibold">Station Code</th>
                        <th className="py-2.5 px-3.5 font-semibold">Station Name</th>
                        <th className="py-2.5 px-3.5 font-semibold">Department</th>
                        <th className="py-2.5 px-3.5 font-semibold">Location</th>
                        <th className="py-2.5 px-3.5 font-semibold">Terminal Status</th>
                        <th className="py-2.5 px-3.5 font-semibold">Camera</th>
                        <th className="py-2.5 px-3.5 font-semibold">Secret Token</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAECEF]">
                      {stations.map((st) => (
                        <tr key={st.id} className="hover:bg-[#F6F7F9]/60 transition-colors">
                          <td className="py-2.5 px-3.5 font-mono font-semibold text-slate-900">{st.station_code}</td>
                          <td className="py-2.5 px-3.5 font-medium text-slate-700">{st.name}</td>
                          <td className="py-2.5 px-3.5">
                            <span className="rounded bg-[#F6F7F9] border border-[#EAECEF] px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
                              {st.department_code}
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-600">{st.location}</td>
                          <td className="py-2.5 px-3.5">
                            <Badge variant="success" className="text-[10px]">{st.status}</Badge>
                          </td>
                          <td className="py-2.5 px-3.5">
                            <Badge variant="brand" className="text-[10px]">{st.camera_status}</Badge>
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-[10px] text-slate-400">
                            {st.station_secret_token ? `${st.station_secret_token.slice(0, 10)}...` : "••••••••"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab 5: Section 8 Policies */}
        {activeTab === "policies" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileCheck2 className="h-4 w-4 text-[#4F46E5]" /> Section 8 Operational Policy Areas
                </CardTitle>
                <CardDescription>
                  Mandatory operational governance policies required before college-wide rollout.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {policies.map((p) => (
                    <div
                      key={p.id}
                      className="p-4 rounded-xl border border-[#EAECEF] bg-white flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:border-[#E5E7EB] transition-colors"
                    >
                      <div className="space-y-1 max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-[#4F46E5]">{p.policy_code}</span>
                          <h4 className="font-semibold text-slate-900 text-sm">{p.title}</h4>
                          {p.status === "CONFIRMED" ? (
                            <Badge variant="success" className="text-[10px]">CONFIRMED</Badge>
                          ) : (
                            <Badge variant="warning" className="text-[10px]">PENDING CONFIRMATION</Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">{p.description}</p>
                        {p.decision_notes && (
                          <p className="text-[11px] text-slate-600 bg-[#F6F7F9] px-3 py-2 rounded-lg mt-1.5 border border-[#EAECEF]">
                            <strong className="font-medium text-slate-800">Decision Notes:</strong> {p.decision_notes}{" "}
                            {p.confirmed_by && <span>— Confirmed by: {p.confirmed_by}</span>}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0">
                        {p.status === "CONFIRMED" ? (
                          <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            <span>Audited &amp; Confirmed</span>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleConfirmPolicy(p.id)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirm Policy
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}

