"use client";

import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CameraCapture } from "@/components/CameraCapture";
import { AuthGuard } from "@/components/AuthGuard";
import {
  api,
  EmployeeRecord,
  DepartmentRecord,
  ShiftTemplateRecord,
  UserProfile,
  ScanSequenceStep,
  canManageEmployees,
  canEnrollBiometrics,
  canManageSchedules,
  isDeptHeadRole,
} from "@/lib/api";
import {
  Search,
  Camera,
  Trash2,
  ShieldCheck,
  CheckCircle,
  CheckCircle2,
  X,
  AlertCircle,
  UserCheck,
  UserPlus,
  Pencil,
  UserX,
  Building2,
  Clock,
  ScanFace,
  ArrowRight,
  Layers,
  Sparkles,
} from "lucide-react";

const UNIVERSITY_JOB_CATEGORIES = [
  { value: "ACADEMIC_LECTURER", label: "Academic Lecturer / Faculty" },
  { value: "LAB_INSTRUCTOR", label: "Lab & Workshop Instructor" },
  { value: "REGULAR_STAFF", label: "Regular Staff" },
  { value: "ADMIN_STAFF", label: "Administrative & Registrar Staff" },
  { value: "RESEARCH_CANDIDATE", label: "Research Candidate / Fellow" },
  { value: "CLEANING_STAFF", label: "Cleaning & Facilities Staff" },
  { value: "SECURITY_GUARD", label: "Campus Security Guard (24h Shifts)" },
];

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplateRecord[]>([]);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [bioFilter, setBioFilter] = useState<"ALL" | "ENROLLED" | "PENDING">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [stageFilter, setStageFilter] = useState<number | null>(null);

  // Department creation modal state
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [deptForm, setDeptForm] = useState({
    name: "",
    code: "",
    faculty_name: "School of Engineering & Technology",
    unit_type: "ACADEMIC_FACULTY",
  });
  const [isSubmittingDept, setIsSubmittingDept] = useState(false);
  const [deptError, setDeptError] = useState<string | null>(null);

  // Unified 5-Step Candidate Lifecycle Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [wizardEmployee, setWizardEmployee] = useState<EmployeeRecord | null>(null);
  const [wizardForm, setWizardForm] = useState({
    employee_number: "",
    first_name: "",
    last_name: "",
    department_id: 1,
    job_category: "ACADEMIC_LECTURER",
    phone: "",
  });
  const [wizardShiftId, setWizardShiftId] = useState<string>("");
  const [wizardEffectiveFrom, setWizardEffectiveFrom] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [wizardCaptureB64, setWizardCaptureB64] = useState<string | null>(null);
  const [wizardVerifyB64, setWizardVerifyB64] = useState<string | null>(null);
  const [wizardVerifyResult, setWizardVerifyResult] = useState<{
    verified: boolean;
    message: string;
    match_score: number;
    quality_score: number;
    scan_sequence: ScanSequenceStep[];
    latency_ms?: number;
  } | null>(null);
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardNotice, setWizardNotice] = useState<string | null>(null);

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
      const [depts, shifts, me] = await Promise.all([
        api.getDepartments(),
        api.getShiftTemplates().catch(() => [] as ShiftTemplateRecord[]),
        api.getMe().catch(() => null),
      ]);
      setDepartments(depts);
      setShiftTemplates(shifts);
      if (me) setCurrentUser(me);
      if (depts.length > 0 && !registerForm.department_id) {
        setRegisterForm((prev) => ({ ...prev, department_id: depts[0].id }));
        setWizardForm((prev) => ({ ...prev, department_id: depts[0].id }));
      }
      if (shifts.length > 0 && !wizardShiftId) {
        setWizardShiftId(String(shifts[0].id));
      }
    } catch (err) {
      console.error("Failed to fetch departments:", err);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem("eipc_user");
        if (cached) setCurrentUser(JSON.parse(cached));
      } catch {
        // ignore
      }
    }
    fetchDepartments();
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [searchQuery]);

  const userRole = currentUser?.role;
  const allowManageEmployees = canManageEmployees(userRole);
  const allowEnrollBiometrics = canEnrollBiometrics(userRole);
  const allowManageSchedules = canManageSchedules(userRole);
  const deptHeadScoped = isDeptHeadRole(userRole);

  const openNewCandidateWizard = () => {
    setWizardEmployee(null);
    setWizardStep(1);
    setWizardForm({
      employee_number: "",
      first_name: "",
      last_name: "",
      department_id: departments[0]?.id || 1,
      job_category: "ACADEMIC_LECTURER",
      phone: "",
    });
    setWizardCaptureB64(null);
    setWizardVerifyB64(null);
    setWizardVerifyResult(null);
    setWizardError(null);
    setWizardNotice(null);
    setWizardOpen(true);
  };

  const openExistingCandidateWizard = (emp: EmployeeRecord) => {
    setWizardEmployee(emp);
    setWizardCaptureB64(null);
    setWizardVerifyB64(null);
    setWizardVerifyResult(null);
    setWizardError(null);
    setWizardNotice(null);
    if (emp.active_shift_id) {
      setWizardShiftId(String(emp.active_shift_id));
    } else if (shiftTemplates.length > 0) {
      setWizardShiftId(String(shiftTemplates[0].id));
    }

    const stage = emp.lifecycle?.stage_number ?? 1;
    if (!emp.consent_verified) setWizardStep(2);
    else if (!emp.has_active_template) setWizardStep(3);
    else if (stage < 4) setWizardStep(4);
    else setWizardStep(5);
    setWizardOpen(true);
  };

  const refreshWizardEmployee = async (empId: number) => {
    const updatedList = await api.getEmployees({ q: searchQuery });
    const list = Array.isArray(updatedList) ? updatedList : [];
    setEmployees(list);
    const refreshed = list.find((item) => item.id === empId) || null;
    if (refreshed) setWizardEmployee(refreshed);
    return refreshed;
  };

  const handleWizardStep1Register = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wizardForm.employee_number.trim() || !wizardForm.first_name.trim() || !wizardForm.last_name.trim()) {
      setWizardError("Candidate ID, first name, and last name are required.");
      return;
    }
    setWizardBusy(true);
    setWizardError(null);
    setWizardNotice(null);
    try {
      const res = await api.createEmployee({
        employee_number: wizardForm.employee_number.trim(),
        first_name: wizardForm.first_name.trim(),
        last_name: wizardForm.last_name.trim(),
        department_id: Number(wizardForm.department_id),
        job_category: wizardForm.job_category,
        phone: wizardForm.phone.trim() || undefined,
        consent_verified: false, // Step 2 captures explicit POL-02 signoff
      });
      await refreshWizardEmployee(res.employee.id);
      setWizardEmployee(res.employee);
      setWizardNotice("Step 1 complete: Candidate profile registered.");
      setWizardStep(2);
    } catch (err: any) {
      setWizardError(err.message || "Failed to register candidate.");
    } finally {
      setWizardBusy(false);
    }
  };

  const handleWizardStep2Consent = async () => {
    if (!wizardEmployee) return;
    setWizardBusy(true);
    setWizardError(null);
    setWizardNotice(null);
    try {
      await api.updateEmployee(wizardEmployee.id, { consent_verified: true });
      await refreshWizardEmployee(wizardEmployee.id);
      setWizardNotice("Step 2 complete: POL-02 privacy & biometric consent verified.");
      setWizardStep(3);
    } catch (err: any) {
      setWizardError(err.message || "Failed to confirm consent.");
    } finally {
      setWizardBusy(false);
    }
  };

  const handleWizardStep3Enroll = async () => {
    if (!wizardEmployee || !wizardCaptureB64) {
      setWizardError("Capture a clear optical frame before enrolling biometrics.");
      return;
    }
    setWizardBusy(true);
    setWizardError(null);
    setWizardNotice(null);
    try {
      const res = await api.enrollFace(wizardEmployee.id, wizardCaptureB64, { consent_verified: true });
      await refreshWizardEmployee(wizardEmployee.id);
      setWizardNotice(res.message || "Step 3 complete: AES-encrypted biometric template stored.");
      setWizardStep(4);
    } catch (err: any) {
      setWizardError(err.message || "Biometric enrollment failed quality checks.");
    } finally {
      setWizardBusy(false);
    }
  };

  const handleWizardStep4Shift = async () => {
    if (!wizardEmployee || !wizardShiftId) {
      setWizardError("Select a shift template to assign.");
      return;
    }
    setWizardBusy(true);
    setWizardError(null);
    setWizardNotice(null);
    try {
      await api.assignShift({
        employee_id: wizardEmployee.id,
        shift_template_id: Number(wizardShiftId),
        effective_from: wizardEffectiveFrom,
        working_days: "0,1,2,3,4",
      });
      await refreshWizardEmployee(wizardEmployee.id);
      setWizardNotice("Step 4 complete: Effective shift schedule linked to candidate.");
      setWizardStep(5);
    } catch (err: any) {
      setWizardError(err.message || "Failed to assign shift schedule.");
    } finally {
      setWizardBusy(false);
    }
  };

  const handleWizardStep5Verify = async () => {
    if (!wizardEmployee || !wizardVerifyB64) {
      setWizardError("Capture a verification test frame to run end-to-end identification.");
      return;
    }
    setWizardBusy(true);
    setWizardError(null);
    setWizardNotice(null);
    try {
      const res = await api.verifyEmployeeIdentification(wizardEmployee.id, {
        image_base64: wizardVerifyB64,
      });
      setWizardVerifyResult(res);
      await refreshWizardEmployee(wizardEmployee.id);
      if (res.verified) {
        setWizardNotice("Step 5 complete: Live optical scan confirmed candidate identity.");
      } else {
        setWizardError(res.message || "Verification scan did not confirm candidate.");
      }
    } catch (err: any) {
      setWizardError(err.message || "Verification test failed.");
    } finally {
      setWizardBusy(false);
    }
  };

  const handleCreateDepartmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptForm.name.trim() || !deptForm.code.trim()) {
      setDeptError("Department name and code are required.");
      return;
    }
    setIsSubmittingDept(true);
    setDeptError(null);
    try {
      await api.createDepartment({
        name: deptForm.name.trim(),
        code: deptForm.code.trim().toUpperCase(),
        faculty_name: deptForm.faculty_name.trim(),
        unit_type: deptForm.unit_type,
      });
      await fetchDepartments();
      setIsDeptModalOpen(false);
      setDeptForm({
        name: "",
        code: "",
        faculty_name: "School of Engineering & Technology",
        unit_type: "ACADEMIC_FACULTY",
      });
    } catch (err: any) {
      setDeptError(err.message || "Failed to create department.");
    } finally {
      setIsSubmittingDept(false);
    }
  };

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
    if (stageFilter !== null) {
      const stageNum = emp.lifecycle?.stage_number ?? (emp.has_active_template ? 3 : 1);
      if (stageFilter === 5 && stageNum < 5) return false;
      if (stageFilter < 5 && stageNum !== stageFilter) return false;
    }
    return true;
  });

  const enrolledCount = employees.filter((e) => e.has_active_template).length;
  const consentedCount = employees.filter((e) => e.consent_verified).length;
  const scheduledCount = employees.filter((e) => (e.lifecycle?.stage_number ?? 0) >= 4 || Boolean(e.active_shift_id)).length;
  const verifiedCount = employees.filter((e) => (e.lifecycle?.stage_number ?? 0) >= 5).length;
  const pendingBioCount = employees.length - enrolledCount;
  const hasDirectoryFilters = Boolean(
    searchQuery || deptFilter || bioFilter !== "ALL" || statusFilter !== "ALL" || stageFilter !== null
  );

  return (
    <AuthGuard>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                Candidate &amp; Academic Roster
              </h1>
              {deptHeadScoped && (
                <Badge variant="brand" className="text-[10px]">
                  Dept Scope: {currentUser?.department_name || currentUser?.department_code || "Assigned Unit"}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              End-to-end university onboarding sequence: Registration → POL-02 Consent → Biometric Face → Shift Schedule → Scan Verification.
            </p>
          </div>

          {allowManageEmployees && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeptError(null);
                  setIsDeptModalOpen(true);
                }}
              >
                <Building2 className="h-3.5 w-3.5" />
                <span>Add Unit / Dept</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsRegisterModalOpen(true);
                  setRegisterError(null);
                }}
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Quick Add</span>
              </Button>
              <Button variant="primary" size="sm" onClick={openNewCandidateWizard}>
                <Sparkles className="h-3.5 w-3.5" />
                <span>Guided Onboarding Wizard</span>
              </Button>
            </div>
          )}
        </div>

        {/* 5-Stage Candidate Lifecycle Pipeline Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {[
            { step: 1, title: "1. Registered", count: employees.length, dot: "bg-slate-400" },
            { step: 2, title: "2. Consent (POL-02)", count: consentedCount, dot: "bg-indigo-500" },
            { step: 3, title: "3. Face Enrolled", count: enrolledCount, dot: "bg-blue-500" },
            { step: 4, title: "4. Shift Assigned", count: scheduledCount, dot: "bg-amber-500" },
            { step: 5, title: "5. Scan Verified", count: verifiedCount, dot: "bg-emerald-500" },
          ].map((stage) => {
            const active = stageFilter === stage.step;
            return (
              <button
                key={stage.step}
                type="button"
                onClick={() => setStageFilter(active ? null : stage.step)}
                className={`text-left rounded-xl border p-3 transition-all ${
                  active
                    ? "border-[#4F46E5] bg-[#EEF2FF]/70 ring-1 ring-[#4F46E5]/30"
                    : "border-[#E5E7EB] bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-500">{stage.title}</span>
                  <span className={`h-2 w-2 rounded-full ${stage.dot}`} />
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-lg font-semibold tracking-tight text-slate-900 tabular-nums">
                    {stage.count}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {employees.length > 0 ? `${Math.round((stage.count / employees.length) * 100)}%` : "0%"}
                  </span>
                </div>
              </button>
            );
          })}
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
                  setStageFilter(null);
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
                  <th className="py-2.5 px-5">Candidate</th>
                  <th className="py-2.5 px-4">ID Number</th>
                  <th className="py-2.5 px-4">Faculty / Unit &amp; Role</th>
                  <th className="py-2.5 px-4">Lifecycle Sequence (1→5)</th>
                  <th className="py-2.5 px-4">Biometrics &amp; Shift</th>
                  <th className="py-2.5 px-4">Consent (POL-02)</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAECEF]">
                {filteredEmployees.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">
                      No matching candidate profiles found.
                    </td>
                  </tr>
                )}
                {filteredEmployees.map((emp) => {
                  const lcSteps = emp.lifecycle?.steps || [];
                  const stageNum = emp.lifecycle?.stage_number ?? (emp.has_active_template ? 3 : 1);
                  return (
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
                      <span className="text-slate-800 block font-medium">{emp.department_name || "General"}</span>
                      <span className="text-[10.5px] text-slate-400 block">
                        {emp.department_faculty || "Ethio-Italy Polytechnic"}
                      </span>
                      <span className="inline-block mt-0.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                        {emp.job_category}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((n) => {
                            const done = lcSteps.find((s) => s.step === n)?.completed ?? n <= stageNum;
                            return (
                              <span
                                key={n}
                                title={lcSteps.find((s) => s.step === n)?.label || `Step ${n}`}
                                className={`h-2 w-5 rounded-full transition-colors ${
                                  done ? "bg-emerald-500" : "bg-slate-200"
                                }`}
                              />
                            );
                          })}
                          <span className="ml-1 font-mono text-[10px] font-semibold text-slate-600">
                            {stageNum}/5
                          </span>
                        </div>
                        <p className="text-[10.5px] text-slate-500 max-w-[180px] truncate">
                          {emp.lifecycle?.next_action || (emp.has_active_template ? "Enrolled" : "Pending Scan")}
                        </p>
                      </div>
                    </td>
                    <td className="py-3 px-4 space-y-1">
                      <div>
                        {emp.has_active_template ? (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle className="h-3 w-3" /> Enrolled
                          </Badge>
                        ) : (
                          <Badge variant="warning">Face Pending</Badge>
                        )}
                      </div>
                      <div className="text-[10.5px] text-slate-500">
                        {emp.active_shift_name ? (
                          <span className="inline-flex items-center gap-1 text-slate-700">
                            <Clock className="h-3 w-3 text-indigo-500" />
                            {emp.active_shift_name}
                          </span>
                        ) : (
                          <span className="text-amber-600">No shift assigned</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {emp.consent_verified ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                          <ShieldCheck className="h-3.5 w-3.5" /> Verified
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-600 font-medium">Pending POL-02</span>
                      )}
                    </td>
                    <td className="py-3 px-5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openExistingCandidateWizard(emp)}
                          title="Open 5-Step Lifecycle Pipeline & Verification"
                          className="border-[#C7D2FE] bg-[#EEF2FF]/60 text-[#4338CA] hover:bg-[#EEF2FF]"
                        >
                          <Layers className="h-3.5 w-3.5" />
                          <span>Pipeline</span>
                        </Button>

                        {allowManageEmployees && (
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
                        )}

                        {allowManageEmployees && (
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
                        )}

                        {allowEnrollBiometrics && (
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
                        )}

                        {allowEnrollBiometrics && emp.has_active_template && (
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
                  );
                })}
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
                    {UNIVERSITY_JOB_CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
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
                isProcessing={isSubmittingEnroll}
                guideText="Center face inside the corner brackets"
                captureButtonText="Capture Enrollment Photo"
                scanState={
                  isSubmittingEnroll
                    ? "scanning"
                    : enrollImageB64
                    ? "matched"
                    : enrollError
                    ? "error"
                    : "idle"
                }
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
                      {UNIVERSITY_JOB_CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      ))}
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

        {/* Modal 6: Create Academic Department / Operational Unit */}
        {isDeptModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-xl space-y-4">
              <div className="flex items-start justify-between border-b border-[#EAECEF] pb-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-[#4F46E5]" />
                    <span>Add Faculty / Academic Department</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Define college faculties, technical units, and administrative offices.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDeptModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {deptError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{deptError}</span>
                </div>
              )}

              <form onSubmit={handleCreateDepartmentSubmit} className="space-y-3 text-xs">
                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    College / Faculty Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={deptForm.faculty_name}
                    onChange={(e) => setDeptForm({ ...deptForm, faculty_name: e.target.value })}
                    placeholder="e.g. Faculty of Computing & Informatics"
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs focus:border-[#4F46E5] focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-medium text-slate-700 block mb-1">
                      Unit Code *
                    </label>
                    <input
                      type="text"
                      required
                      value={deptForm.code}
                      onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value.toUpperCase() })}
                      placeholder="e.g. DEPT-CIVIL"
                      className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs font-mono uppercase focus:border-[#4F46E5] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-700 block mb-1">
                      Unit Classification *
                    </label>
                    <select
                      value={deptForm.unit_type}
                      onChange={(e) => setDeptForm({ ...deptForm, unit_type: e.target.value })}
                      className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs bg-white focus:border-[#4F46E5] focus:outline-none"
                    >
                      <option value="ACADEMIC_FACULTY">ACADEMIC_FACULTY</option>
                      <option value="TECHNICAL_DEPT">TECHNICAL_DEPT</option>
                      <option value="ADMIN_UNIT">ADMIN_UNIT</option>
                      <option value="CAMPUS_OPERATIONS">CAMPUS_OPERATIONS</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-700 block mb-1">
                    Department / Unit Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={deptForm.name}
                    onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                    placeholder="e.g. Civil & Construction Engineering"
                    className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs focus:border-[#4F46E5] focus:outline-none"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t border-[#EAECEF]">
                  <Button type="button" variant="outline" size="sm" onClick={() => setIsDeptModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" size="sm" isLoading={isSubmittingDept}>
                    Create Department
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal 7: Unified 5-Step Candidate Registration-to-Identification Wizard */}
        {wizardOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-[2px] overflow-y-auto">
            <div className="w-full max-w-2xl rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-2xl space-y-4 my-auto">
              <div className="flex items-start justify-between border-b border-[#EAECEF] pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">
                      Candidate Onboarding &amp; Identification Pipeline
                    </h3>
                    <Badge variant="brand" className="text-[10px]">
                      Step {wizardStep} of 5
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {wizardEmployee
                      ? `${wizardEmployee.employee_number} · ${wizardEmployee.first_name} ${wizardEmployee.last_name} (${wizardEmployee.department_name || "Assigned Unit"})`
                      : "New candidate commissioning workflow from registration to live optical identification."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setWizardOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* 5-Stage Interactive Stepper */}
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { n: 1 as const, label: "1. Register", done: Boolean(wizardEmployee) },
                  { n: 2 as const, label: "2. Consent", done: Boolean(wizardEmployee?.consent_verified) },
                  { n: 3 as const, label: "3. Biometrics", done: Boolean(wizardEmployee?.has_active_template) },
                  { n: 4 as const, label: "4. Shift", done: (wizardEmployee?.lifecycle?.stage_number ?? 0) >= 4 },
                  { n: 5 as const, label: "5. Verify Scan", done: (wizardEmployee?.lifecycle?.stage_number ?? 0) >= 5 },
                ].map((s) => {
                  const clickable = s.n === 1 ? !wizardEmployee : Boolean(wizardEmployee);
                  const active = wizardStep === s.n;
                  return (
                    <button
                      key={s.n}
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && setWizardStep(s.n)}
                      className={`rounded-lg border px-2 py-2 text-left transition-all ${
                        active
                          ? "border-[#4F46E5] bg-[#EEF2FF] text-[#4338CA]"
                          : s.done
                          ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                          : "border-[#E5E7EB] bg-[#FAFBFD] text-slate-500"
                      } ${!clickable ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-semibold">
                        <span className="truncate">{s.label}</span>
                        {s.done && <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              {wizardNotice && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{wizardNotice}</span>
                </div>
              )}

              {wizardError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{wizardError}</span>
                </div>
              )}

              {/* STEP 1: Profile Registration */}
              {wizardStep === 1 && !wizardEmployee && (
                <form onSubmit={handleWizardStep1Register} className="space-y-3 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Candidate ID / Emp # *
                      </label>
                      <input
                        type="text"
                        required
                        value={wizardForm.employee_number}
                        onChange={(e) => setWizardForm({ ...wizardForm, employee_number: e.target.value })}
                        placeholder="e.g. EIPC-LEC-204"
                        className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 font-mono uppercase focus:border-[#4F46E5] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Academic Rank / Job Category *
                      </label>
                      <select
                        value={wizardForm.job_category}
                        onChange={(e) => setWizardForm({ ...wizardForm, job_category: e.target.value })}
                        className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 bg-white focus:border-[#4F46E5] focus:outline-none"
                      >
                        {UNIVERSITY_JOB_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">First Name *</label>
                      <input
                        type="text"
                        required
                        value={wizardForm.first_name}
                        onChange={(e) => setWizardForm({ ...wizardForm, first_name: e.target.value })}
                        className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 focus:border-[#4F46E5] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">Last Name *</label>
                      <input
                        type="text"
                        required
                        value={wizardForm.last_name}
                        onChange={(e) => setWizardForm({ ...wizardForm, last_name: e.target.value })}
                        className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 focus:border-[#4F46E5] focus:outline-none"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        College Faculty &amp; Department *
                      </label>
                      <select
                        value={wizardForm.department_id}
                        onChange={(e) =>
                          setWizardForm({ ...wizardForm, department_id: Number(e.target.value) })
                        }
                        className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 bg-white focus:border-[#4F46E5] focus:outline-none"
                      >
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.faculty_name ? `${d.faculty_name} → ` : ""}
                            {d.name} ({d.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-3 border-t border-[#EAECEF]">
                    <Button type="button" variant="outline" size="sm" onClick={() => setWizardOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" size="sm" isLoading={wizardBusy}>
                      <span>Register &amp; Continue to Consent</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </form>
              )}

              {/* STEP 2: Privacy Consent POL-02 */}
              {wizardStep === 2 && wizardEmployee && (
                <div className="space-y-4 text-xs">
                  <div className="rounded-xl border border-[#EAECEF] bg-[#FAFBFD] p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-[#4F46E5]" />
                        Institutional Biometric Consent Policy (POL-02)
                      </span>
                      <Badge variant={wizardEmployee.consent_verified ? "success" : "warning"}>
                        {wizardEmployee.consent_verified ? "CONSENT VERIFIED" : "PENDING SIGNOFF"}
                      </Badge>
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      Candidate <strong>{wizardEmployee.first_name} {wizardEmployee.last_name}</strong> ({wizardEmployee.employee_number})
                      acknowledges encrypted AES-128-CBC neural face embedding storage strictly for institutional attendance verification,
                      subject to right-to-erasure under Policy POL-02.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t border-[#EAECEF]">
                    {wizardEmployee.consent_verified ? (
                      <Button variant="primary" size="sm" onClick={() => setWizardStep(3)}>
                        <span>Continue to Step 3: Biometrics</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    ) : allowManageEmployees ? (
                      <Button variant="primary" size="sm" onClick={handleWizardStep2Consent} isLoading={wizardBusy}>
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>Verify Consent &amp; Proceed to Capture</span>
                      </Button>
                    ) : (
                      <span className="text-[11px] text-amber-700">
                        HR Officer / Admin approval is required to verify POL-02 consent.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 3: Biometric Face Enrollment */}
              {wizardStep === 3 && wizardEmployee && (
                <div className="space-y-3 text-xs">
                  {allowEnrollBiometrics ? (
                    <>
                      <CameraCapture
                        title="Step 3: Live Optical Enrollment Capture"
                        subtitle={`Center ${wizardEmployee.first_name} in steady lighting without hats or glasses.`}
                        onCapture={(b64) => {
                          setWizardCaptureB64(b64);
                          setWizardError(null);
                        }}
                        isBusy={wizardBusy}
                        actionLabel="Lock Enrollment Frame"
                      />
                      <div className="flex items-center justify-between pt-2 border-t border-[#EAECEF]">
                        {wizardEmployee.has_active_template ? (
                          <Button variant="outline" size="sm" onClick={() => setWizardStep(4)}>
                            Skip (Keep Enrolled Template) →
                          </Button>
                        ) : (
                          <span className="text-[11px] text-slate-500">
                            {wizardCaptureB64 ? "Frame locked. Ready to encrypt & enroll." : "Capture an optical frame above."}
                          </span>
                        )}
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleWizardStep3Enroll}
                          disabled={!wizardCaptureB64}
                          isLoading={wizardBusy}
                        >
                          <Camera className="h-3.5 w-3.5" />
                          <span>Enroll Biometrics &amp; Proceed</span>
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                      Only authorized HR Officers or System Admins may enroll or replace candidate face templates.
                    </div>
                  )}
                </div>
              )}

              {/* STEP 4: Operational Shift Assignment */}
              {wizardStep === 4 && wizardEmployee && (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Operational Shift Template *
                      </label>
                      <select
                        value={wizardShiftId}
                        onChange={(e) => setWizardShiftId(e.target.value)}
                        className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 bg-white focus:border-[#4F46E5] focus:outline-none"
                      >
                        {shiftTemplates.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name} · {st.start_time}-{st.end_time} ({st.job_category})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Effective From *
                      </label>
                      <input
                        type="date"
                        value={wizardEffectiveFrom}
                        onChange={(e) => setWizardEffectiveFrom(e.target.value)}
                        className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 focus:border-[#4F46E5] focus:outline-none"
                      />
                    </div>
                  </div>
                  {wizardEmployee.active_shift_name && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                      Current Active Shift: <strong>{wizardEmployee.active_shift_name}</strong>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-[#EAECEF]">
                    {(wizardEmployee.lifecycle?.stage_number ?? 0) >= 4 ? (
                      <Button variant="outline" size="sm" onClick={() => setWizardStep(5)}>
                        Continue to Step 5: Verify Scan →
                      </Button>
                    ) : (
                      <span className="text-[11px] text-slate-500">
                        Assigning a shift enables punctual/late evaluation at campus terminals.
                      </span>
                    )}
                    {allowManageSchedules && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleWizardStep4Shift}
                        disabled={!wizardShiftId}
                        isLoading={wizardBusy}
                      >
                        <Clock className="h-3.5 w-3.5" />
                        <span>Assign Shift &amp; Proceed to Verification</span>
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 5: Live Test Scan & Identification Verification */}
              {wizardStep === 5 && wizardEmployee && (
                <div className="space-y-3 text-xs">
                  {allowEnrollBiometrics ? (
                    <CameraCapture
                      title="Step 5: Commissioning Verification Scan (Dry-Run)"
                      subtitle={`Verify live end-to-end 5-stage optical match against ${wizardEmployee.employee_number} without punching attendance.`}
                      onCapture={(b64) => {
                        setWizardVerifyB64(b64);
                        setWizardError(null);
                      }}
                      isBusy={wizardBusy}
                      actionLabel="Capture Verification Frame"
                    />
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-600">
                      Department Heads can monitor completion status here. Biometric test scans require HR/Admin authorization.
                    </div>
                  )}

                  {wizardVerifyResult && (
                    <div className="rounded-xl border border-[#E5E7EB] bg-[#FAFBFD] p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">
                          5-Stage Scan Trace · {wizardVerifyResult.latency_ms ?? 0} ms
                        </span>
                        <Badge variant={wizardVerifyResult.verified ? "success" : "danger"}>
                          {wizardVerifyResult.verified
                            ? `VERIFIED (${Math.round(wizardVerifyResult.match_score * 100)}%)`
                            : "VERIFICATION FAILED"}
                        </Badge>
                      </div>
                      <div className="space-y-1.5">
                        {wizardVerifyResult.scan_sequence.map((st) => (
                          <div
                            key={st.stage}
                            className="flex items-center justify-between rounded-lg border border-[#EAECEF] bg-white px-2.5 py-1.5"
                          >
                            <div>
                              <span className="font-medium text-slate-800">
                                {st.step}. {st.label}
                              </span>
                              <p className="text-[10.5px] text-slate-500">{st.detail}</p>
                            </div>
                            <Badge
                              variant={
                                st.status === "PASSED"
                                  ? "success"
                                  : st.status === "FAILED"
                                  ? "danger"
                                  : "outline"
                              }
                              className="text-[10px]"
                            >
                              {st.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-[#EAECEF]">
                    <Button variant="outline" size="sm" onClick={() => setWizardOpen(false)}>
                      Close Pipeline
                    </Button>
                    {allowEnrollBiometrics && (
                      <Button
                        variant="success"
                        size="sm"
                        onClick={handleWizardStep5Verify}
                        disabled={!wizardVerifyB64}
                        isLoading={wizardBusy}
                      >
                        <ScanFace className="h-3.5 w-3.5" />
                        <span>Run Live Identification Test</span>
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}

