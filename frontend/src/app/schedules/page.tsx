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
  Building2,
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
  Sparkles,
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Screen 5 — Schedules, Ethiopian Clock & Stations
            </h1>
            <Badge variant="brand" className="text-xs">AT-15..AT-24</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Configure regular, sanitation & 24h guard shifts with dual Ethiopian-Clock mapping, assign effective schedules, manage leaves, and register trusted stations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} isLoading={isLoading}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh Data
          </Button>
        </div>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-center justify-between ${
            statusMessage.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-rose-50 text-rose-800 border-rose-200"
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
            className="text-xs font-semibold hover:underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-slate-50/50 border-slate-200/80">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Shift Templates</p>
              <p className="text-xl font-bold text-slate-800">{templates.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-50/50 border-slate-200/80">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Active Assignments</p>
              <p className="text-xl font-bold text-slate-800">{assignments.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-50/50 border-slate-200/80">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Registered Stations</p>
              <p className="text-xl font-bold text-slate-800">{stations.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-50/50 border-slate-200/80">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <FileCheck2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Confirmed Policies</p>
              <p className="text-xl font-bold text-slate-800">
                {policies.filter((p) => p.status === "CONFIRMED").length} / {policies.length}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto gap-2">
        <button
          onClick={() => setActiveTab("templates")}
          className={`py-2.5 px-4 text-xs font-semibold border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            activeTab === "templates"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          Shift Templates & Ethiopian Clock (AT-15..18)
        </button>

        <button
          onClick={() => setActiveTab("assignments")}
          className={`py-2.5 px-4 text-xs font-semibold border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            activeTab === "assignments"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Briefcase className="h-3.5 w-3.5" />
          Effective Assignments (AT-19)
        </button>

        <button
          onClick={() => setActiveTab("exceptions")}
          className={`py-2.5 px-4 text-xs font-semibold border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            activeTab === "exceptions"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Calendar className="h-3.5 w-3.5" />
          Holidays & Leaves (AT-20)
        </button>

        <button
          onClick={() => setActiveTab("stations")}
          className={`py-2.5 px-4 text-xs font-semibold border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            activeTab === "stations"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Radio className="h-3.5 w-3.5" />
          Attendance Stations & Tokens (AT-22, 24)
        </button>

        <button
          onClick={() => setActiveTab("policies")}
          className={`py-2.5 px-4 text-xs font-semibold border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            activeTab === "policies"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Section 8 Policy Sign-Offs
        </button>
      </div>

      {/* Tab 1: Shift Templates */}
      {activeTab === "templates" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Create Shift Template Form */}
          <Card className="lg:col-span-1 shadow-sm">
            <CardHeader className="bg-slate-50 border-b border-slate-100">
              <CardTitle className="text-sm flex items-center gap-2">
                <Plus className="h-4 w-4 text-blue-600" /> Create Shift Template
              </CardTitle>
              <CardDescription className="text-xs">
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
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Job Category *</label>
                  <select
                    value={newShift.job_category}
                    onChange={(e) => setNewShift({ ...newShift, job_category: e.target.value })}
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
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
                      className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">End Time (24h EAT) *</label>
                    <input
                      type="time"
                      required
                      value={newShift.end_time}
                      onChange={(e) => setNewShift({ ...newShift, end_time: e.target.value })}
                      className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Live Ethiopian Clock Translation Preview */}
                <div className="rounded-lg bg-amber-50 border border-amber-200/80 p-3 text-[11px] text-amber-900">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-800 mb-1">
                    <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                    Ethiopian Clock Translation Preview (AT-16):
                  </div>
                  <div className="font-mono text-xs">
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
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Break Rules</label>
                  <input
                    type="text"
                    value={newShift.break_rules}
                    onChange={(e) => setNewShift({ ...newShift, break_rules: e.target.value })}
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-2 pt-1 border-t border-slate-100">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newShift.spans_midnight}
                      onChange={(e) => setNewShift({ ...newShift, spans_midnight: e.target.checked })}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-slate-700 font-medium">Overnight Shift Spans Midnight (AT-17)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newShift.is_24_hour}
                      onChange={(e) => setNewShift({ ...newShift, is_24_hour: e.target.checked })}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-slate-700 font-medium">24-Hour Guard Shift (+1 Day Window, AT-18)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newShift.hr_approved}
                      onChange={(e) => setNewShift({ ...newShift, hr_approved: e.target.checked })}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
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
          <Card className="lg:col-span-2 shadow-sm">
            <CardHeader className="bg-slate-50 border-b border-slate-100 flex flex-row items-center justify-between py-3">
              <div>
                <CardTitle className="text-sm">Configured Shift Templates & Ethiopian Time</CardTitle>
                <CardDescription className="text-xs">
                  Active schedules across academic, administrative, and security departments.
                </CardDescription>
              </div>
              <Badge variant="brand" className="text-xs">{templates.length} Active</Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Shift Name</th>
                      <th className="py-2.5 px-3 font-semibold">Category</th>
                      <th className="py-2.5 px-3 font-semibold">24h EAT</th>
                      <th className="py-2.5 px-3 font-semibold">Ethiopian Clock Equivalent</th>
                      <th className="py-2.5 px-3 font-semibold">Grace</th>
                      <th className="py-2.5 px-3 font-semibold">Type</th>
                      <th className="py-2.5 px-3 font-semibold">HR Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {templates.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{t.name}</td>
                        <td className="py-2.5 px-3">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
                            {t.job_category}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {t.start_time} - {t.end_time}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="brand" className="text-[10px] font-mono">
                            {t.ethiopian_display}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">{t.grace_period_minutes}m</td>
                        <td className="py-2.5 px-3">
                          {t.is_24_hour ? (
                            <Badge variant="warning" className="text-[10px]">24-Hour (+1d)</Badge>
                          ) : t.spans_midnight ? (
                            <Badge variant="warning" className="text-[10px]">Overnight (+1d)</Badge>
                          ) : (
                            <span className="text-slate-400">Standard</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Assignment Form */}
          <Card className="lg:col-span-1 shadow-sm">
            <CardHeader className="bg-slate-50 border-b border-slate-100">
              <CardTitle className="text-sm flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-indigo-600" /> Assign Employee Schedule
              </CardTitle>
              <CardDescription className="text-xs">
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
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
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
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
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
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Effective To (Optional)</label>
                  <input
                    type="date"
                    value={newAssignment.effective_to}
                    onChange={(e) => setNewAssignment({ ...newAssignment, effective_to: e.target.value })}
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Working Days (0=Mon..6=Sun)</label>
                  <input
                    type="text"
                    value={newAssignment.working_days}
                    onChange={(e) => setNewAssignment({ ...newAssignment, working_days: e.target.value })}
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" size="sm">
                  Assign Schedule (AT-19)
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Assignments List */}
          <Card className="lg:col-span-2 shadow-sm">
            <CardHeader className="bg-slate-50 border-b border-slate-100 flex flex-row items-center justify-between py-3">
              <div>
                <CardTitle className="text-sm">Effective-Dated Employee Schedules</CardTitle>
                <CardDescription className="text-xs">
                  Schedule changes apply strictly from their effective dates without retroactive mutation.
                </CardDescription>
              </div>
              <Badge variant="brand" className="text-xs">{assignments.length} Records</Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Employee</th>
                      <th className="py-2.5 px-3 font-semibold">Shift Template</th>
                      <th className="py-2.5 px-3 font-semibold">Ethiopian Window</th>
                      <th className="py-2.5 px-3 font-semibold">Effective Range</th>
                      <th className="py-2.5 px-3 font-semibold">Workdays</th>
                      <th className="py-2.5 px-3 font-semibold">Approved By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {assignments.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-3">
                          <p className="font-semibold text-slate-800">{a.employee_name}</p>
                          <p className="text-[10px] font-mono text-slate-500">{a.employee_number}</p>
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-700">{a.shift_name}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant="brand" className="text-[10px] font-mono">
                            {a.ethiopian_display}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {a.effective_from} → {a.effective_to || "Open-ended"}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">{a.working_days}</td>
                        <td className="py-2.5 px-3 text-slate-500">{a.approved_by}</td>
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Create Exception Form */}
          <Card className="lg:col-span-1 shadow-sm">
            <CardHeader className="bg-slate-50 border-b border-slate-100">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4 text-emerald-600" /> Record Holiday or Leave (AT-20)
              </CardTitle>
              <CardDescription className="text-xs">
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
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Exception Type *</label>
                  <select
                    value={newException.exception_type}
                    onChange={(e) => setNewException({ ...newException, exception_type: e.target.value })}
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
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
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
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
                      className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">End Date *</label>
                    <input
                      type="date"
                      required
                      value={newException.end_date}
                      onChange={(e) => setNewException({ ...newException, end_date: e.target.value })}
                      className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
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
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" size="sm">
                  Add Approved Exception
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Exceptions Table */}
          <Card className="lg:col-span-2 shadow-sm">
            <CardHeader className="bg-slate-50 border-b border-slate-100 flex flex-row items-center justify-between py-3">
              <div>
                <CardTitle className="text-sm">Configured Exceptions & Leaves</CardTitle>
                <CardDescription className="text-xs">
                  Days exempted from absence penalties and overdue flags.
                </CardDescription>
              </div>
              <Badge variant="brand" className="text-xs">{exceptions.length} Configured</Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Title</th>
                      <th className="py-2.5 px-3 font-semibold">Type</th>
                      <th className="py-2.5 px-3 font-semibold">Scope</th>
                      <th className="py-2.5 px-3 font-semibold">Dates</th>
                      <th className="py-2.5 px-3 font-semibold">Reason</th>
                      <th className="py-2.5 px-3 font-semibold">Approved By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {exceptions.map((ex) => (
                      <tr key={ex.id} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{ex.title}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant="brand" className="text-[10px]">{ex.exception_type}</Badge>
                        </td>
                        <td className="py-2.5 px-3">
                          {ex.employee_id ? (
                            <span className="font-mono text-slate-600">{ex.employee_name} ({ex.employee_number})</span>
                          ) : (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                              ALL COLLEGE STAFF
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {ex.start_date} → {ex.end_date}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">{ex.reason || "—"}</td>
                        <td className="py-2.5 px-3 text-slate-500">{ex.approved_by}</td>
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Station Registration Form */}
          <Card className="lg:col-span-1 shadow-sm">
            <CardHeader className="bg-slate-50 border-b border-slate-100">
              <CardTitle className="text-sm flex items-center gap-2">
                <Radio className="h-4 w-4 text-blue-600" /> Register Department Station
              </CardTitle>
              <CardDescription className="text-xs">
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
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none uppercase font-mono"
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
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Assigned Department *</label>
                  <select
                    required
                    value={newStation.department_id}
                    onChange={(e) => setNewStation({ ...newStation, department_id: e.target.value })}
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
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
                    className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <Button type="submit" className="w-full" size="sm">
                  Register Departmental Station
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Stations Table */}
          <Card className="lg:col-span-2 shadow-sm">
            <CardHeader className="bg-slate-50 border-b border-slate-100 flex flex-row items-center justify-between py-3">
              <div>
                <CardTitle className="text-sm">Registered Departmental Attendance Stations</CardTitle>
                <CardDescription className="text-xs">
                  Trusted hardware devices and browser terminals cryptographically verified via station tokens.
                </CardDescription>
              </div>
              <Badge variant="brand" className="text-xs">{stations.length} Registered</Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Station Code</th>
                      <th className="py-2.5 px-3 font-semibold">Station Name</th>
                      <th className="py-2.5 px-3 font-semibold">Department</th>
                      <th className="py-2.5 px-3 font-semibold">Location</th>
                      <th className="py-2.5 px-3 font-semibold">Terminal Status</th>
                      <th className="py-2.5 px-3 font-semibold">Camera</th>
                      <th className="py-2.5 px-3 font-semibold">Secret Token</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stations.map((st) => (
                      <tr key={st.id} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{st.station_code}</td>
                        <td className="py-2.5 px-3 font-medium text-slate-700">{st.name}</td>
                        <td className="py-2.5 px-3">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
                            {st.department_code}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{st.location}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant="success" className="text-[10px]">{st.status}</Badge>
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="brand" className="text-[10px]">{st.camera_status}</Badge>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[10px] text-slate-400">
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
          <Card className="shadow-sm">
            <CardHeader className="bg-slate-50 border-b border-slate-100">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileCheck2 className="h-4 w-4 text-blue-600" /> Section 8 Operational Policy Areas
              </CardTitle>
              <CardDescription className="text-xs">
                Mandatory operational governance policies required before college-wide rollout.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-4">
                {policies.map((p) => (
                  <div
                    key={p.id}
                    className="p-4 rounded-lg border border-slate-200 bg-white flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1 max-w-2xl">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-700">{p.policy_code}</span>
                        <h4 className="font-bold text-slate-900 text-sm">{p.title}</h4>
                        {p.status === "CONFIRMED" ? (
                          <Badge variant="success" className="text-[10px]">CONFIRMED</Badge>
                        ) : (
                          <Badge variant="warning" className="text-[10px]">PENDING CONFIRMATION</Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-600">{p.description}</p>
                      {p.decision_notes && (
                        <p className="text-[11px] text-slate-500 italic bg-slate-50 p-2 rounded mt-1 border border-slate-100">
                          <strong>Decision Notes:</strong> {p.decision_notes}{" "}
                          {p.confirmed_by && <span>— Confirmed by: {p.confirmed_by}</span>}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0">
                      {p.status === "CONFIRMED" ? (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 px-3 py-1.5 rounded-md border border-emerald-200">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <span>Audited & Confirmed</span>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleConfirmPolicy(p.id)}
                          className="bg-blue-600 hover:bg-blue-700 text-xs"
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

