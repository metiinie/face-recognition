"use client";

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CameraCapture } from "@/components/CameraCapture";
import { AuthGuard } from "@/components/AuthGuard";
import { api, EmployeeRecord } from "@/lib/api";
import {
  Search,
  Camera,
  Trash2,
  ShieldCheck,
  CheckCircle,
  X,
  AlertCircle,
  UserCheck,
  UserPlus,
  Pencil,
  UserX,
} from "lucide-react";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: number; name: string; code: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [bioFilter, setBioFilter] = useState<"ALL" | "ENROLLED" | "PENDING">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");

  // New staff registration modal state
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    employee_number: "",
    first_name: "",
    last_name: "",
    department_id: 1,
    job_category: "REGULAR_STAFF",
    phone: "",
    consent_verified: true,
  });
  const [isSubmittingRegister, setIsSubmittingRegister] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // Enrollment modal state
  const [activeEnrollEmployee, setActiveEnrollEmployee] = useState<EmployeeRecord | null>(null);
  const [enrollImageB64, setEnrollImageB64] = useState<string | null>(null);
  const [isSubmittingEnroll, setIsSubmittingEnroll] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollSuccess, setEnrollSuccess] = useState<string | null>(null);

  // Purge modal state
  const [activePurgeEmployee, setActivePurgeEmployee] = useState<EmployeeRecord | null>(null);
  const [purgeReason, setPurgeReason] = useState("Biometric consent withdrawn / Right to erasure");
  const [isSubmittingPurge, setIsSubmittingPurge] = useState(false);

  // Edit employee modal state
  const [editingEmployee, setEditingEmployee] = useState<EmployeeRecord | null>(null);
  const [editForm, setEditForm] = useState({
    first_name: "",
    last_name: "",
    department_id: 1,
    job_category: "REGULAR_STAFF",
    phone: "",
    consent_verified: true,
  });
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Status toggle modal state
  const [statusTargetEmployee, setStatusTargetEmployee] = useState<EmployeeRecord | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const fetchEmployees = async () => {
    setIsLoading(true);
    try {
      const data = await api.getEmployees({ q: searchQuery });
      setEmployees(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch employees:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDepartments = async () => {
    try {
      const depts = await api.getDepartments();
      setDepartments(depts);
      if (depts.length > 0 && !registerForm.department_id) {
        setRegisterForm((prev) => ({ ...prev, department_id: depts[0].id }));
      }
    } catch (err) {
      console.error("Failed to fetch departments:", err);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, [searchQuery]);

  useEffect(() => {
    fetchDepartments();
  }, []);

  const handleRegisterSubmit = async (autoEnroll: boolean) => {
    if (!registerForm.employee_number || !registerForm.first_name || !registerForm.last_name) {
      setRegisterError("Employee number, first name, and last name are required.");
      return;
    }
    setIsSubmittingRegister(true);
    setRegisterError(null);

    try {
      const res = await api.createEmployee({
        employee_number: registerForm.employee_number.trim(),
        first_name: registerForm.first_name.trim(),
        last_name: registerForm.last_name.trim(),
        department_id: Number(registerForm.department_id),
        job_category: registerForm.job_category,
        phone: registerForm.phone.trim() || undefined,
        consent_verified: registerForm.consent_verified,
      });

      await fetchEmployees();
      setIsRegisterModalOpen(false);

      const createdEmp = res.employee;
      // Reset form
      setRegisterForm({
        employee_number: "",
        first_name: "",
        last_name: "",
        department_id: departments[0]?.id || 1,
        job_category: "REGULAR_STAFF",
        phone: "",
        consent_verified: true,
      });

      if (autoEnroll && createdEmp) {
        // Automatically open the camera enrollment modal for the newly registered staff member
        setActiveEnrollEmployee({
          id: createdEmp.id,
          employee_number: createdEmp.employee_number,
          first_name: createdEmp.first_name || registerForm.first_name,
          last_name: createdEmp.last_name || registerForm.last_name,
          department_id: createdEmp.department_id,
          department_name: departments.find((d) => d.id === createdEmp.department_id)?.name || "General",
          job_category: createdEmp.job_category,
          status: createdEmp.status,
          consent_verified: registerForm.consent_verified,
          has_active_template: false,
        });
        setEnrollImageB64(null);
        setEnrollError(null);
        setEnrollSuccess(null);
      }
    } catch (err: any) {
      setRegisterError(err.message || "Failed to register employee.");
    } finally {
      setIsSubmittingRegister(false);
    }
  };

  const handleCaptureForEnrollment = (b64: string) => {
    setEnrollImageB64(b64);
    setEnrollError(null);
  };

  const handleConfirmEnrollment = async () => {
    if (!activeEnrollEmployee || !enrollImageB64) return;
    setIsSubmittingEnroll(true);
    setEnrollError(null);
    setEnrollSuccess(null);

    try {
      const res = await api.enrollFace({
        employee_id: activeEnrollEmployee.id,
        image_base64: enrollImageB64,
        quality_mode: "LIVE_CAPTURE",
      });
      setEnrollSuccess(res.message || "Biometric template enrolled and encrypted.");
      await fetchEmployees();
      setTimeout(() => {
        setActiveEnrollEmployee(null);
        setEnrollImageB64(null);
        setEnrollSuccess(null);
      }, 1800);
    } catch (err: any) {
      setEnrollError(err.message || "Enrollment rejected. Please adjust position/lighting.");
    } finally {
      setIsSubmittingEnroll(false);
    }
  };

  const handleConfirmPurge = async () => {
    if (!activePurgeEmployee) return;
    setIsSubmittingPurge(true);
    try {
      await api.purgeBiometrics(activePurgeEmployee.id, purgeReason);
      setActivePurgeEmployee(null);
      await fetchEmployees();
    } catch (err: any) {
      alert(`Purge failed: ${err.message}`);
    } finally {
      setIsSubmittingPurge(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;
    setIsSubmittingEdit(true);
    setEditError(null);
    try {
      await api.updateEmployee(editingEmployee.id, {
        first_name: editForm.first_name.trim(),
        last_name: editForm.last_name.trim(),
        department_id: Number(editForm.department_id),
        job_category: editForm.job_category,
        phone: editForm.phone.trim() || undefined,
        consent_verified: editForm.consent_verified,
      });
      setEditingEmployee(null);
      await fetchEmployees();
    } catch (err: any) {
      setEditError(err.message || "Failed to update employee details.");
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleStatusToggleSubmit = async () => {
    if (!statusTargetEmployee) return;
    setIsSubmittingStatus(true);
    setStatusError(null);
    const newStatus = statusTargetEmployee.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await api.setEmployeeStatus(
        statusTargetEmployee.id,
        newStatus,
        statusReason.trim() || undefined
      );
      setStatusTargetEmployee(null);
      await fetchEmployees();
    } catch (err: any) {
      setStatusError(err.message || "Failed to update employee status.");
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  const filteredEmployees = employees.filter((emp) => {
    if (deptFilter && String(emp.department_id) !== deptFilter) return false;
    if (bioFilter === "ENROLLED" && !emp.has_active_template) return false;
    if (bioFilter === "PENDING" && emp.has_active_template) return false;
    if (statusFilter !== "ALL" && emp.status !== statusFilter) return false;
    return true;
  });

  const enrolledCount = employees.filter((e) => e.has_active_template).length;
  const pendingBioCount = employees.length - enrolledCount;
  const hasDirectoryFilters = Boolean(searchQuery || deptFilter || bioFilter !== "ALL" || statusFilter !== "ALL");

  return (
    <AuthGuard>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Employee Directory
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Manage staff profiles, consent verification, live biometric enrollment, and right-to-erasure.
            </p>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setIsRegisterModalOpen(true);
              setRegisterError(null);
            }}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Add Employee</span>
          </Button>
        </div>

        {/* Summary Strip */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3.5">
            <span className="text-[11px] font-medium text-slate-500">Directory Total</span>
            <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {employees.length}
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500">Biometrics Enrolled</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {enrolledCount}
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500">Pending Face Scan</span>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {pendingBioCount}
            </div>
          </Card>
        </div>

        {/* Image 1 Style Compact Filter Strip */}
        <Card className="p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search name or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-full rounded-lg border border-[#E5E7EB] bg-white pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                />
              </div>

              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                aria-label="Filter by Department"
                className="h-8 rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] px-2.5 text-xs text-slate-700 focus:border-[#4F46E5] focus:bg-white focus:outline-none"
              >
                <option value="">All Departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.name}
                  </option>
                ))}
              </select>

              <div className="inline-flex h-8 items-center rounded-lg border border-[#EAECEF] bg-[#F6F7F9] p-0.5 text-xs">
                {(["ALL", "ENROLLED", "PENDING"] as const).map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setBioFilter(val)}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                      bioFilter === val
                        ? "bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    {val === "ALL" ? "All Faces" : val === "ENROLLED" ? "Enrolled" : "Pending"}
                  </button>
                ))}
              </div>

              <div className="inline-flex h-8 items-center rounded-lg border border-[#EAECEF] bg-[#F6F7F9] p-0.5 text-xs">
                {(["ALL", "ACTIVE", "INACTIVE"] as const).map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setStatusFilter(val)}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                      statusFilter === val
                        ? "bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    {val === "ALL" ? "All Status" : val === "ACTIVE" ? "Active" : "Inactive"}
                  </button>
                ))}
              </div>
            </div>

            {hasDirectoryFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setDeptFilter("");
                  setBioFilter("ALL");
                  setStatusFilter("ALL");
                }}
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Clear filters
              </button>
            )}
          </div>
        </Card>

        {/* Employee Table */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#EAECEF] bg-[#FAFBFD] text-[10.5px] font-medium text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-5">Employee</th>
                  <th className="py-2.5 px-4">ID Number</th>
                  <th className="py-2.5 px-4">Department</th>
                  <th className="py-2.5 px-4">Biometrics</th>
                  <th className="py-2.5 px-4">Consent (POL-01)</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAECEF]">
                {filteredEmployees.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      No matching employee profiles found.
                    </td>
                  </tr>
                )}
                {filteredEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-[#FAFBFD] transition-colors">
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#4338CA] font-semibold text-[11px] uppercase">
                          {emp.first_name?.[0] || "E"}
                          {emp.last_name?.[0] || ""}
                        </div>
                        <div>
                          <span className="font-medium text-slate-900 block">
                            {emp.first_name} {emp.last_name}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-[10.5px] font-medium ${
                              emp.status === "ACTIVE" ? "text-emerald-600" : "text-slate-400"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                emp.status === "ACTIVE" ? "bg-emerald-500" : "bg-slate-400"
                              }`}
                            />
                            {emp.status === "ACTIVE" ? "Active" : "Inactive"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] font-medium text-slate-700 tabular-nums">
                      {emp.employee_number}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-slate-800 block">{emp.department_name || "General"}</span>
                      <span className="text-[11px] text-slate-400">{emp.job_category}</span>
                    </td>
                    <td className="py-3 px-4">
                      {emp.has_active_template ? (
                        <Badge variant="success" className="gap-1">
                          <CheckCircle className="h-3 w-3" /> Enrolled
                        </Badge>
                      ) : (
                        <Badge variant="warning">Pending</Badge>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {emp.consent_verified ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                          <ShieldCheck className="h-3.5 w-3.5" /> Verified
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-600 font-medium">Unverified</span>
                      )}
                    </td>
                    <td className="py-3 px-5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingEmployee(emp);
                            setEditForm({
                              first_name: emp.first_name || "",
                              last_name: emp.last_name || "",
                              department_id: emp.department_id || departments[0]?.id || 1,
                              job_category: emp.job_category || "REGULAR_STAFF",
                              phone: (emp as unknown as { phone?: string }).phone || "",
                              consent_verified: Boolean(emp.consent_verified),
                            });
                            setEditError(null);
                          }}
                          title="Edit Profile"
                          className="px-2 text-slate-600"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setStatusTargetEmployee(emp);
                            setStatusReason(
                              emp.status === "ACTIVE"
                                ? "Employee leave / administrative deactivation"
                                : "Employee reactivation"
                            );
                            setStatusError(null);
                          }}
                          title={emp.status === "ACTIVE" ? "Deactivate (AT-07)" : "Activate"}
                          className={`px-2 ${
                            emp.status === "ACTIVE"
                              ? "text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                              : "text-emerald-600 hover:bg-emerald-50"
                          }`}
                        >
                          {emp.status === "ACTIVE" ? (
                            <UserX className="h-3.5 w-3.5" />
                          ) : (
                            <UserCheck className="h-3.5 w-3.5" />
                          )}
                        </Button>

                        <Button
                          variant={emp.has_active_template ? "outline" : "primary"}
                          size="sm"
                          onClick={() => {
                            setActiveEnrollEmployee(emp);
                            setEnrollImageB64(null);
                            setEnrollError(null);
                            setEnrollSuccess(null);
                          }}
                        >
                          <Camera className="h-3.5 w-3.5" />
                          <span>{emp.has_active_template ? "Re-Enroll" : "Enroll"}</span>
                        </Button>

                        {emp.has_active_template && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActivePurgeEmployee(emp)}
                            className="px-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                            title="Purge biometric template (POL-02)"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Modal 1: Register New Staff */}
        {isRegisterModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-lg rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-[#EAECEF] pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Register New Employee</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Create staff profile and department assignment before face capture.
                  </p>
                </div>
                <button
                  onClick={() => setIsRegisterModalOpen(false)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {registerError && (
                <div className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800 border border-rose-200 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{registerError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    Employee ID Number *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. EIPC-EMP-006"
                    value={registerForm.employee_number}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, employee_number: e.target.value.toUpperCase() })
                    }
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs font-mono focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. +251 91 123 4567"
                    value={registerForm.phone}
                    onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    First Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Dawit"
                    value={registerForm.first_name}
                    onChange={(e) => setRegisterForm({ ...registerForm, first_name: e.target.value })}
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Tadesse"
                    value={registerForm.last_name}
                    onChange={(e) => setRegisterForm({ ...registerForm, last_name: e.target.value })}
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    Department *
                  </label>
                  <select
                    value={registerForm.department_id}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, department_id: Number(e.target.value) })
                    }
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs bg-white focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  >
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name} ({dept.code})
                      </option>
                    ))}
                    {departments.length === 0 && (
                      <option value={1}>General Academic & Administration</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    Job Category *
                  </label>
                  <select
                    value={registerForm.job_category}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, job_category: e.target.value })
                    }
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs bg-white focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  >
                    <option value="REGULAR_STAFF">Regular Staff (Academic & Admin)</option>
                    <option value="CLEANING_STAFF">Cleaning Staff (Facilities)</option>
                    <option value="SECURITY_GUARD">Security Guard (24h Shifts)</option>
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-[#EAECEF] bg-[#FAFBFD] p-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={registerForm.consent_verified}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, consent_verified: e.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#4F46E5] focus:ring-indigo-500"
                  />
                  <span className="text-xs text-slate-600 leading-snug">
                    <strong className="text-slate-900">Biometric Consent Verified (POL-01):</strong> Employee signed College consent for encrypted facial template storage.
                  </span>
                </label>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-[#EAECEF]">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsRegisterModalOpen(false)}
                  disabled={isSubmittingRegister}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRegisterSubmit(false)}
                  isLoading={isSubmittingRegister}
                >
                  Save Profile Only
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleRegisterSubmit(true)}
                  isLoading={isSubmittingRegister}
                >
                  <Camera className="h-3.5 w-3.5" />
                  <span>Save &amp; Enroll Face</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal 2: Live Biometric Enrollment with Image 3 Viewfinder */}
        {activeEnrollEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-xl rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-[#EAECEF] pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Biometric Face Enrollment
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {activeEnrollEmployee.first_name} {activeEnrollEmployee.last_name} ({activeEnrollEmployee.employee_number})
                  </p>
                </div>
                <button
                  onClick={() => setActiveEnrollEmployee(null)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <CameraCapture
                onCapture={handleCaptureForEnrollment}
                guideText="Center face inside the corner brackets"
                captureButtonText="Capture Enrollment Photo"
                scanState={enrollImageB64 ? "matched" : enrollError ? "error" : "idle"}
              />

              {enrollImageB64 && !enrollSuccess && !enrollError && (
                <div className="rounded-lg bg-[#EEF2FF] p-3 text-xs text-[#4338CA] border border-indigo-200 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>Snapshot ready. Click <strong>Save Encrypted Template</strong> to enroll.</span>
                </div>
              )}

              {enrollError && (
                <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{enrollError}</span>
                </div>
              )}

              {enrollSuccess && (
                <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>{enrollSuccess}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-3 border-t border-[#EAECEF]">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#4F46E5]" />
                  <span>Fernet AES-128 encrypted at rest</span>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveEnrollEmployee(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleConfirmEnrollment}
                    disabled={!enrollImageB64 || isSubmittingEnroll}
                    isLoading={isSubmittingEnroll}
                  >
                    Save Encrypted Template
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal 3: Right to Erasure / Purge */}
        {activePurgeEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-xl space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 border border-rose-200 text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Right to Erasure (POL-02)</h3>
                  <p className="text-xs text-slate-500">
                    Purge biometrics for {activePurgeEmployee.first_name} {activePurgeEmployee.last_name}
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Permanently deletes all encrypted facial embeddings for this employee, withdraws biometric consent, and writes an immutable audit entry.
              </p>

              <div>
                <label className="text-[11px] font-medium text-slate-700 block mb-1">
                  Reason for Erasure
                </label>
                <input
                  type="text"
                  value={purgeReason}
                  onChange={(e) => setPurgeReason(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/15"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#EAECEF]">
                <Button variant="outline" size="sm" onClick={() => setActivePurgeEmployee(null)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleConfirmPurge}
                  isLoading={isSubmittingPurge}
                >
                  Permanently Purge
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal 4: Edit Employee Profile */}
        {editingEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-lg rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-[#EAECEF] pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Edit Employee Profile</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    {editingEmployee.employee_number}
                  </p>
                </div>
                <button
                  onClick={() => setEditingEmployee(null)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {editError && (
                <div className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800 border border-rose-200 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              <form onSubmit={handleEditSubmit} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="text-[11px] font-medium text-slate-700 block mb-1">
                      First Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={editForm.first_name}
                      onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                      className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-700 block mb-1">
                      Last Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={editForm.last_name}
                      onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                      className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="text-[11px] font-medium text-slate-700 block mb-1">
                      Department *
                    </label>
                    <select
                      value={editForm.department_id}
                      onChange={(e) => setEditForm({ ...editForm, department_id: Number(e.target.value) })}
                      className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs bg-white focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                    >
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-700 block mb-1">
                      Job Category
                    </label>
                    <select
                      value={editForm.job_category}
                      onChange={(e) => setEditForm({ ...editForm, job_category: e.target.value })}
                      className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs bg-white focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                    >
                      <option value="REGULAR_STAFF">Regular Academic/Admin Staff</option>
                      <option value="CLEANING_STAFF">Cleaning / Sanitation Staff</option>
                      <option value="SECURITY_GUARD">Security Guard (24h/Rotational)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    placeholder="+251 ..."
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>

                <div className="flex items-start gap-2.5 rounded-lg border border-[#EAECEF] bg-[#FAFBFD] p-3">
                  <input
                    type="checkbox"
                    id="edit_consent_verified"
                    checked={editForm.consent_verified}
                    onChange={(e) =>
                      setEditForm({ ...editForm, consent_verified: e.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#4F46E5] focus:ring-indigo-500"
                  />
                  <label htmlFor="edit_consent_verified" className="text-xs text-slate-600 cursor-pointer leading-snug">
                    <strong className="text-slate-900">Biometric Consent Verified (POL-01):</strong> Active signed agreement. Unchecking revokes face templates.
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-[#EAECEF]">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingEmployee(null)}
                    disabled={isSubmittingEdit}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    isLoading={isSubmittingEdit}
                  >
                    Save Changes
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal 5: Toggle Status */}
        {statusTargetEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-xl space-y-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                    statusTargetEmployee.status === "ACTIVE"
                      ? "bg-amber-50 border-amber-200 text-amber-700"
                      : "bg-emerald-50 border-emerald-200 text-emerald-700"
                  }`}
                >
                  {statusTargetEmployee.status === "ACTIVE" ? (
                    <UserX className="h-4 w-4" />
                  ) : (
                    <UserCheck className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {statusTargetEmployee.status === "ACTIVE" ? "Deactivate Employee" : "Reactivate Employee"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {statusTargetEmployee.first_name} {statusTargetEmployee.last_name} ({statusTargetEmployee.employee_number})
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                {statusTargetEmployee.status === "ACTIVE"
                  ? "Deactivating prevents future biometric punches while preserving historical sessions and audit logs (AT-07)."
                  : "Reactivating restores active status and allows attendance punching."}
              </p>

              {statusError && (
                <div className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800 border border-rose-200">
                  {statusError}
                </div>
              )}

              <div>
                <label className="text-[11px] font-medium text-slate-700 block mb-1">
                  Reason
                </label>
                <input
                  type="text"
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  placeholder="e.g. Leave of absence / resumed duties"
                  className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EAECEF]">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStatusTargetEmployee(null)}
                  disabled={isSubmittingStatus}
                >
                  Cancel
                </Button>
                <Button
                  variant={statusTargetEmployee.status === "ACTIVE" ? "danger" : "success"}
                  size="sm"
                  onClick={handleStatusToggleSubmit}
                  isLoading={isSubmittingStatus}
                >
                  Confirm {statusTargetEmployee.status === "ACTIVE" ? "Deactivation" : "Reactivation"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}

