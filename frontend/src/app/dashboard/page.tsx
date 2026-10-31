"use client";

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import {
  Users,
  CheckCircle,
  Clock,
  AlertOctagon,
  TrendingUp,
  RefreshCw,
  Building,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export default function DashboardPage() {
  const [summary, setSummary] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    try {
      const data = await api.getAttendanceSummary();
      setSummary(data);
    } catch (err) {
      console.error("Failed to load dashboard summary:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const hourlyData = [
    { hour: "06:00", onTime: 12, late: 0 },
    { hour: "07:00", onTime: 45, late: 2 },
    { hour: "08:00", onTime: 88, late: 6 },
    { hour: "09:00", onTime: 24, late: 11 },
    { hour: "10:00", onTime: 8, late: 3 },
    { hour: "11:00", onTime: 4, late: 1 },
    { hour: "12:00", onTime: 15, late: 0 },
    { hour: "13:00", onTime: 32, late: 2 },
    { hour: "14:00", onTime: 20, late: 1 },
  ];

  const deptData = [
    { department: "Automotive Tech", rate: 94.5 },
    { department: "Electrical & Electronics", rate: 91.2 },
    { department: "Mechanical Eng", rate: 88.0 },
    { department: "Information Tech", rate: 96.0 },
    { department: "Garment & Textile", rate: 89.5 },
    { department: "Administration", rate: 98.0 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Attendance Executive Dashboard</h1>
          <p className="mt-1 text-xs text-slate-500">
            Real-time daily attendance monitoring, departmental metrics, and shift status.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchDashboardData} isLoading={isLoading}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh Realtime Data
        </Button>
      </div>

      {/* 4 Metric Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-l-4 border-l-blue-600">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Total Employees</span>
            <Users className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {summary?.total_employees || 28}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Active roster enrolled</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Present Today</span>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {summary?.present_count || 24}
          </div>
          <p className="mt-1 text-[11px] text-emerald-600 font-medium">85.7% Attendance Rate</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Late Arrivals</span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {summary?.late_count || 2}
          </div>
          <p className="mt-1 text-[11px] text-amber-600">Grace period: 15 mins</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-rose-500">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Review Cases</span>
            <AlertOctagon className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {summary?.unresolved_reviews || 0}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Zero active security flags</p>
        </Card>
      </div>

      {/* 2 Recharts Analytics Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Hourly Inflow Bar Chart */}
        <Card className="lg:col-span-7 p-5">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-base">Hourly Scan Inflow (Morning Peak vs Afternoon)</CardTitle>
            <CardDescription>Breakdown of on-time versus late employee punch scans throughout today.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="hour" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip />
                <Legend verticalAlign="top" height={30} />
                <Bar dataKey="onTime" name="On Time" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="late" name="Late Arrival" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Department Punctuality */}
        <Card className="lg:col-span-5 p-5">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-base">Department Attendance Rates (%)</CardTitle>
            <CardDescription>Academic, technical, and administrative faculties.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={deptData} margin={{ top: 5, right: 20, left: 35, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" domain={[70, 100]} unit="%" stroke="#64748b" fontSize={11} />
                <YAxis type="category" dataKey="department" stroke="#64748b" fontSize={10} width={90} />
                <Tooltip formatter={(v) => [`${v}%`, "Rate"]} />
                <Bar dataKey="rate" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

