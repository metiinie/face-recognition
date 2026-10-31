"use client";

import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CameraCapture } from "@/components/CameraCapture";
import { api, EmployeeRecord } from "@/lib/api";
import {
  Users,
  Search,
  Camera,
  Trash2,
  ShieldCheck,
  CheckCircle,
  X,
  AlertCircle,
  UserCheck,
  UserPlus,
  Plus,
  Building2,
  Briefcase,
  Phone,
} from "lucide-react";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: number; name: string; code: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Employee Biometric Directory</h1>
          <p className="mt-1 text-xs text-slate-500">
            Register new staff profiles, manage live webcam biometric enrollment, verify consent, and handle data erasure.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-4 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Register New Staff Button */}
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setIsRegisterModalOpen(true);
              setRegisterError(null);
            }}
            className="flex items-center justify-center gap-1.5 shadow-sm font-semibold"
          >
            <UserPlus className="h-4 w-4" />
            <span>Register New Staff</span>
          </Button>
        </div>
      </div>

      {/* Employee Table */}
      <Card className="overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">ID Number</th>
                <th className="py-3 px-4">Department & Category</th>
                <th className="py-3 px-4">Biometric Status</th>
                <th className="py-3 px-4">Consent (POL-01)</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    <UserCheck className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    No employees found. Click <strong>"Register New Staff"</strong> above to onboard an employee.
                  </td>
                </tr>
              )}
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700 font-bold text-xs uppercase">
                        {(emp.first_name?.[0] || "E")}
                        {(emp.last_name?.[0] || "")}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-900 block">
                          {emp.first_name} {emp.last_name}
                        </span>
                        <span className="text-[10px] text-slate-500">{emp.status}</span>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono font-medium text-slate-700">
                    {emp.employee_number}
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-medium text-slate-800 block">{emp.department_name || "General"}</span>
                    <span className="text-[10px] text-slate-500">{emp.job_category}</span>
                  </td>
                  <td className="py-3 px-4">
                    {emp.has_active_template ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle className="h-3 w-3" /> Enrolled
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">
                        Not Enrolled
                      </Badge>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {emp.consent_verified ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                        <ShieldCheck className="h-3.5 w-3.5" /> Verified
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-600 font-medium">Unverified</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
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
                        <Camera className="mr-1 h-3.5 w-3.5" />
                        {emp.has_active_template ? "Re-Enroll" : "Enroll Face"}
                      </Button>

                      {emp.has_active_template && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActivePurgeEmployee(emp)}
                          className="text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                          title="Purge biometric template (Right to Erasure)"
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

      {/* Modal 1: Register New Staff Member */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Register New Staff Member</h3>
                  <p className="text-xs text-slate-500">
                    Create employee profile and department assignment before face scan.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsRegisterModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {registerError && (
              <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{registerError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Employee ID */}
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Employee ID Number *
                </label>
                <input
                  type="text"
                  placeholder="e.g. EIPC-EMP-006"
                  value={registerForm.employee_number}
                  onChange={(e) =>
                    setRegisterForm({ ...registerForm, employee_number: e.target.value.toUpperCase() })
                  }
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. +251 91 123 4567"
                  value={registerForm.phone}
                  onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* First Name */}
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  First Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Dawit"
                  value={registerForm.first_name}
                  onChange={(e) => setRegisterForm({ ...registerForm, first_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Last Name */}
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Last Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Tadesse"
                  value={registerForm.last_name}
                  onChange={(e) => setRegisterForm({ ...registerForm, last_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Department */}
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Department *
                </label>
                <select
                  value={registerForm.department_id}
                  onChange={(e) =>
                    setRegisterForm({ ...registerForm, department_id: Number(e.target.value) })
                  }
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
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

              {/* Job Category */}
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Job Category *
                </label>
                <select
                  value={registerForm.job_category}
                  onChange={(e) =>
                    setRegisterForm({ ...registerForm, job_category: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                >
                  <option value="REGULAR_STAFF">Regular Staff (Academic & Admin)</option>
                  <option value="CLEANING_STAFF">Cleaning Staff (Facilities & Maintenance)</option>
                  <option value="SECURITY_GUARD">Security Guard (Gate & 24h Shifts)</option>
                </select>
              </div>
            </div>

            {/* Consent verification checkbox */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={registerForm.consent_verified}
                  onChange={(e) =>
                    setRegisterForm({ ...registerForm, consent_verified: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-700 leading-snug">
                  <strong>Biometric Consent Verified (POL-01):</strong> Employee has signed the College
                  biometric attendance consent form and consented to encrypted facial template storage.
                </span>
              </label>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t">
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
                Save Staff Only
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleRegisterSubmit(true)}
                isLoading={isSubmittingRegister}
                className="shadow-sm font-semibold"
              >
                <Camera className="mr-1.5 h-3.5 w-3.5" />
                Save & Enroll Face Now
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Live Biometric Face Enrollment */}
      {activeEnrollEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Biometric Face Enrollment
                </h3>
                <p className="text-xs text-slate-500">
                  Enrolling: {activeEnrollEmployee.first_name} {activeEnrollEmployee.last_name} ({activeEnrollEmployee.employee_number})
                </p>
              </div>
              <button
                onClick={() => setActiveEnrollEmployee(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Camera Viewport */}
            <div className="rounded-xl overflow-hidden bg-slate-950 p-2">
              <CameraCapture
                onCapture={handleCaptureForEnrollment}
                guideText="Look directly at camera. Hold still for quality verification."
              />
            </div>

            {/* Status alerts */}
            {enrollError && (
              <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{enrollError}</span>
              </div>
            )}

            {enrollSuccess && (
              <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>{enrollSuccess}</span>
              </div>
            )}

            {/* Action Bar */}
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <ShieldCheck className="h-4 w-4 text-blue-600" />
                <span>Encrypted at rest via Fernet AES-128</span>
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

      {/* Modal 3: Right to Erasure / Biometric Purge */}
      {activePurgeEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Right to Erasure (POL-02)</h3>
                <p className="text-xs text-slate-500">
                  Permanently purge biometrics for {activePurgeEmployee.first_name} {activePurgeEmployee.last_name}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              This action permanently deletes all encrypted face embeddings for this employee from the database, resets consent status, and records an immutable entry in the audit trail.
            </p>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Reason for Erasure:
              </label>
              <input
                type="text"
                value={purgeReason}
                onChange={(e) => setPurgeReason(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
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
    </div>
  );
}

