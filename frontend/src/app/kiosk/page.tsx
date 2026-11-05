"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { CameraCapture } from "@/components/CameraCapture";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { api, RecognitionResult, AttendanceConfirmResponse, StationRecord } from "@/lib/api";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  UserCheck,
  ShieldCheck,
  Clock,
  Sparkles,
  Zap,
  LifeBuoy,
  Send,
  UserPlus,
  ArrowRight,
  LogIn,
  LogOut,
} from "lucide-react";

export default function KioskPage() {
  const [stationId, setStationId] = useState("ST-ICT-01");
  const [stationsList, setStationsList] = useState<StationRecord[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);

  useEffect(() => {
    api.getStationDirectory()
      .then((dir) => {
        if (dir.stations && dir.stations.length > 0) {
          setStationsList(dir.stations);
          setStationId(dir.stations[0].station_code);
        }
        if (dir.employees && dir.employees.length > 0) {
          setEmployees(dir.employees);
          setEnrollTargetEmpId(dir.employees[0].id);
        }
      })
      .catch((err) => {
        console.warn("Could not load station directory, using defaults:", err);
      });
  }, []);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const [recognition, setRecognition] = useState<RecognitionResult | null>(null);
  const [attendanceOutcome, setAttendanceOutcome] = useState<AttendanceConfirmResponse | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [punchError, setPunchError] = useState<string | null>(null);
  const [lastCapturedImage, setLastCapturedImage] = useState<string | null>(null);

  // Quick Biometric Enrollment State
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollTargetEmpId, setEnrollTargetEmpId] = useState<number | "">("");
  const [isSubmittingEnroll, setIsSubmittingEnroll] = useState(false);
  const [enrollSuccess, setEnrollSuccess] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  // HR Review / Assistance state
  const [showHelpDrawer, setShowHelpDrawer] = useState(false);
  const [claimedEmpNumber, setClaimedEmpNumber] = useState("");
  const [helpReason, setHelpReason] = useState("");
  const [isSubmittingHelp, setIsSubmittingHelp] = useState(false);
  const [helpSuccess, setHelpSuccess] = useState<string | null>(null);
  const [helpError, setHelpError] = useState<string | null>(null);

  const handleCapture = async (base64Image: string) => {
    setLastCapturedImage(base64Image);
    setIsProcessing(true);
    setFeedbackError(null);
    setPunchError(null);
    setAttendanceOutcome(null);

    try {
      const res = await api.recognizeFace({
        image_base64: base64Image,
        station_id: stationId,
        quality_mode: "LIVE_CAPTURE",
      });
      setRecognition(res);

      if (!res.matched) {
        setFeedbackError(res.rejection_message || "Face not recognized. Please adjust position or contact HR.");
      }
    } catch (err: any) {
      console.error("Recognition call failed:", err);
      setFeedbackError(err.message || "Failed to communicate with attendance server.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmEnrollment = async () => {
    if (!enrollTargetEmpId || !lastCapturedImage) return;
    setIsSubmittingEnroll(true);
    setEnrollError(null);
    try {
      await api.quickEnrollFace({
        employee_id: Number(enrollTargetEmpId),
        image_base64: lastCapturedImage,
      });
      setShowEnrollModal(false);
      setEnrollSuccess("Biometric template enrolled successfully! Rescanning now...");
      setFeedbackError(null);
      handleCapture(lastCapturedImage);
    } catch (err: any) {
      setEnrollError(err.message || "Failed to enroll biometric face template.");
    } finally {
      setIsSubmittingEnroll(false);
    }
  };

  const handleSimulateScan = async (signature: string, label: string) => {
    setIsProcessing(true);
    setFeedbackError(null);
    setPunchError(null);
    setAttendanceOutcome(null);

    try {
      const res = await api.recognizeFace({
        biometric_signature: signature,
        station_id: stationId,
        quality_mode: "SIMULATION",
      });
      setRecognition(res);

      if (!res.matched) {
        setFeedbackError(res.rejection_message || `${label}: Match rejected by face engine.`);
      }
    } catch (err: any) {
      console.error("Simulation failed:", err);
      setFeedbackError(err.message || "Failed to communicate with attendance server.");
    } finally {
      setIsProcessing(false);
    }
  };

  const [selectedAction, setSelectedAction] = useState<"CHECK_IN" | "CHECK_OUT" | null>(null);

  const handleConfirmAttendance = async (action: "CHECK_IN" | "CHECK_OUT") => {
    if (!recognition?.recognition_token) return;

    setSelectedAction(action);
    setIsConfirming(true);
    setPunchError(null);
    try {
      const outcome = await api.confirmAttendance({
        recognition_token: recognition.recognition_token,
        station_id: stationId,
        event_type: action,
      });
      setAttendanceOutcome(outcome);
    } catch (err: any) {
      console.error("Attendance confirmation error:", err);
      setPunchError(err.message || "Failed to record attendance event.");
    } finally {
      setIsConfirming(false);
      setSelectedAction(null);
    }
  };

  const handleReset = () => {
    setRecognition(null);
    setAttendanceOutcome(null);
    setFeedbackError(null);
    setPunchError(null);
    setShowHelpDrawer(false);
    setHelpSuccess(null);
    setHelpError(null);
  };

  const handleSubmitHelp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingHelp(true);
    setHelpError(null);
    setHelpSuccess(null);

    try {
      const res = await api.requestStationReview({
        station_code: stationId,
        station_id: stationId,
        case_type: recognition?.rejection_code || "UNKNOWN_FACE",
        claimed_employee_number: claimedEmpNumber.trim() || undefined,
        reason: helpReason.trim() || "Unregistered face at kiosk requesting HR biometric registration.",
      });
      setHelpSuccess(res.message);
      setClaimedEmpNumber("");
      setHelpReason("");
    } catch (err: any) {
      setHelpError(err.message || "Failed to submit HR review request.");
    } finally {
      setIsSubmittingHelp(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-950 p-6 text-white shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Kiosk Attendance Terminal</h1>
            <Badge variant="brand" className="bg-blue-500/20 text-blue-300 border-blue-400/30">
              UltraFace + SFace ONNX (OpenCV)
            </Badge>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-slate-300">
            Real-time biometric attendance with sub-200ms latency and anti-spoofing presentation attack detection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEnrollError(null);
              setShowEnrollModal(true);
            }}
            className="text-xs h-8 bg-white/10 hover:bg-white/20 text-white border-white/20"
          >
            <UserPlus className="h-3.5 w-3.5 mr-1.5 text-emerald-400" />
            Quick Face Enrollment
          </Button>

          {/* Station Selector */}
          <div className="flex items-center gap-2 rounded-xl bg-white/10 p-1.5 backdrop-blur-md">
            <span className="text-xs text-slate-300 font-medium">Terminal Station:</span>
            <select
              value={stationId}
              onChange={(e) => setStationId(e.target.value)}
              className="rounded-lg bg-slate-900/90 px-3 py-1 text-xs text-white border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            >
              {stationsList.length > 0 ? (
                stationsList.map((st) => (
                  <option key={st.id} value={st.station_code}>
                    {st.station_code} — {st.name} ({st.department_code})
                  </option>
                ))
              ) : (
                <>
                  <option value="ST-ICT-01">Block A - ICT Wing (Kiosk #1)</option>
                  <option value="ST-AUTO-01">Automotive & Mechanical (Kiosk #2)</option>
                  <option value="ST-CIVIL-01">Textile & Civil Block (Kiosk #3)</option>
                  <option value="ST-GATE-01">Main Campus Gate (Kiosk #4)</option>
                </>
              )}
            </select>
          </div>
        </div>
      </div>

      {enrollSuccess && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs font-medium text-emerald-800 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            {enrollSuccess}
          </span>
          <button onClick={() => setEnrollSuccess(null)} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
      )}

      {/* Main Grid: Left Camera, Right Decision Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Camera Viewport */}
        <div className="lg:col-span-7">
          <Card className="p-4 bg-slate-950 border-slate-900 shadow-2xl">
            <CameraCapture
              onCapture={handleCapture}
              isProcessing={isProcessing}
              autoScanIntervalMs={1600}
              guideText="Align face within the green oval for automatic recognition"
            />
            <div className="mt-3 flex items-center justify-between px-2 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Multi-factor Anti-Spoofing (PAD) Active
              </span>
              <span className="flex items-center gap-1 font-mono">
                <Zap className="h-3.5 w-3.5 text-amber-400" /> Target Latency: &lt; 250ms
              </span>
            </div>

            {/* Quick Test Simulation Strip */}
            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-slate-300">
                  Quick Simulation Mode (Kiosk Testing):
                </span>
                <span className="text-[10px] text-blue-400 font-mono">ALLOW_SIMULATED_BIOMETRICS=1</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleSimulateScan("FACE_SIG_EIPC-EMP-001", "Abebe Kebede")}
                  className="rounded bg-slate-800 hover:bg-blue-600 px-2 py-1 text-[10px] font-medium text-slate-200 transition-colors"
                >
                  👤 Abebe Kebede
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleSimulateScan("FACE_SIG_EIPC-EMP-002", "Hanna Mekonnen")}
                  className="rounded bg-slate-800 hover:bg-blue-600 px-2 py-1 text-[10px] font-medium text-slate-200 transition-colors"
                >
                  👤 Hanna Mekonnen
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleSimulateScan("FACE_SIG_EIPC-EMP-003", "Chaltu Girma")}
                  className="rounded bg-slate-800 hover:bg-blue-600 px-2 py-1 text-[10px] font-medium text-slate-200 transition-colors"
                >
                  👤 Chaltu Girma
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleSimulateScan("UNKNOWN_PERSON_001", "Unknown Visitor")}
                  className="rounded bg-slate-800 hover:bg-amber-600 px-2 py-1 text-[10px] font-medium text-slate-200 transition-colors"
                >
                  ❓ Unknown Visitor
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleSimulateScan("POOR_LIGHTING", "Poor Lighting")}
                  className="rounded bg-slate-800 hover:bg-rose-600 px-2 py-1 text-[10px] font-medium text-slate-200 transition-colors"
                >
                  ⚠️ Obstructed / Glare
                </button>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Instant Recognition Result & Confirmation Card */}
        <div className="lg:col-span-5 space-y-4">
          {/* Card State 1: Idle waiting for scan */}
          {!recognition && !feedbackError && (
            <Card className="border-dashed border-2 border-slate-200 bg-slate-50/50 p-8 text-center text-slate-500">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <UserCheck className="h-8 w-8" />
              </div>
              <h3 className="text-base font-semibold text-slate-800">Ready for Employee Scan</h3>
              <p className="mt-2 text-xs text-slate-500 max-w-sm mx-auto">
                Look directly into the camera. The system will detect your face, verify anti-spoofing liveness, and verify against your encrypted biometric template.
              </p>
            </Card>
          )}

          {/* Card State 2: Face Recognized Successfully */}
          {recognition?.matched && recognition.employee && !attendanceOutcome && (
            <Card className="border-emerald-300 bg-emerald-50/40 p-6 shadow-lg shadow-emerald-500/10">
              <div className="flex items-center justify-between">
                <Badge variant="success" className="text-xs py-1 px-3">
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Biometric Identity Verified
                </Badge>
                {recognition.latency_ms && (
                  <span className="font-mono text-xs font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                    {recognition.latency_ms} ms
                  </span>
                )}
              </div>

              {/* Employee Bio Card */}
              <div className="mt-4 flex items-center gap-4 border-b border-emerald-200/80 pb-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-white text-xl font-bold shadow-md">
                  {recognition.employee.first_name[0]}
                  {recognition.employee.last_name[0]}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {recognition.employee.first_name} {recognition.employee.last_name}
                  </h2>
                  <p className="font-mono text-xs text-slate-600">
                    ID: {recognition.employee.employee_number}
                  </p>
                  <p className="text-xs text-slate-500">
                    {recognition.employee.department_name} • {recognition.employee.job_category}
                  </p>
                </div>
              </div>

              {/* Match Metrics breakdown */}
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white p-2.5 border border-emerald-200">
                  <span className="text-slate-500 block text-[11px]">Cosine Match Score</span>
                  <span className="font-bold text-emerald-700 text-sm">
                    {recognition.match_score ? `${(recognition.match_score * 100).toFixed(1)}%` : "N/A"}
                  </span>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-emerald-200">
                  <span className="text-slate-500 block text-[11px]">Anti-Spoofing</span>
                  <span className="font-bold text-emerald-700 text-sm flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Live Bona Fide
                  </span>
                </div>
              </div>

              {/* Punch Error Notice */}
              {punchError && (
                <div className="mt-3 rounded-lg bg-rose-100 border border-rose-300 p-2.5 text-xs text-rose-800 flex items-center gap-2">
                  <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{punchError}</span>
                </div>
              )}

              {/* Explicit Check-In and Check-Out Selection */}
              <div className="mt-5 space-y-3">
                <p className="text-xs font-semibold text-slate-700 text-center">
                  Select Attendance Action to Confirm:
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="success"
                    size="lg"
                    className="w-full text-sm font-bold shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 py-4"
                    onClick={() => handleConfirmAttendance("CHECK_IN")}
                    isLoading={isConfirming && selectedAction === "CHECK_IN"}
                    disabled={isConfirming}
                  >
                    <LogIn className="h-5 w-5" />
                    <span>Check-In (መግቢያ)</span>
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full text-sm font-bold bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 py-4"
                    onClick={() => handleConfirmAttendance("CHECK_OUT")}
                    isLoading={isConfirming && selectedAction === "CHECK_OUT"}
                    disabled={isConfirming}
                  >
                    <LogOut className="h-5 w-5" />
                    <span>Check-Out (መውጫ)</span>
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-slate-500"
                  onClick={handleReset}
                  disabled={isConfirming}
                >
                  Rescan / Cancel
                </Button>
              </div>
            </Card>
          )}

          {/* Card State 3: Attendance Successfully Created / Punched */}
          {attendanceOutcome && (
            <Card className="border-blue-400 bg-blue-50/50 p-6 text-center shadow-xl">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/30">
                <Sparkles className="h-8 w-8" />
              </div>
              <Badge variant="brand" className="text-xs py-1 px-3">
                {attendanceOutcome.event_type === "CHECK_IN" ? "CHECK-IN RECORDED" : "CHECK-OUT RECORDED"}
              </Badge>
              <h2 className="mt-3 text-lg font-bold text-slate-900">{attendanceOutcome.message}</h2>
              <p className="mt-1 font-mono text-xs text-slate-600">
                Timestamp: {new Date(attendanceOutcome.timestamp).toLocaleTimeString()} (EAT)
              </p>

              {attendanceOutcome.is_late && (
                <div className="mt-3 rounded-lg bg-amber-100 p-2 text-xs font-semibold text-amber-800">
                  Late Arrival: {attendanceOutcome.minutes_late} minute(s) past shift start.
                </div>
              )}

              <Button variant="primary" size="md" className="mt-6 w-full" onClick={handleReset}>
                Done • Next Person
              </Button>
            </Card>
          )}

          {/* Card State 4: Rejection / Anomaly Detected (Only if not matched) */}
          {feedbackError && !recognition?.matched && (
            <Card className="border-rose-300 bg-rose-50/60 p-6 shadow-lg space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-600 text-white shrink-0">
                  <XCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-rose-900 text-sm">Recognition Rejected</h3>
                  {recognition?.rejection_code && (
                    <Badge variant="danger" className="mt-0.5 text-[10px] font-mono">
                      {recognition.rejection_code}
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-xs text-rose-700 bg-white/70 p-3 rounded-lg border border-rose-200">
                {feedbackError}
              </p>

              {recognition && typeof recognition.match_score === "number" && recognition.match_score > 0 && (
                <div className="flex items-center justify-between text-[11px] text-slate-600 bg-slate-100/90 px-3 py-1.5 rounded-lg border border-slate-200">
                  <span>Match Confidence: <strong className="font-mono">{(recognition.match_score * 100).toFixed(1)}%</strong></span>
                  <span>Required: <strong className="font-mono">35.0%</strong></span>
                </div>
              )}

              {helpSuccess && (
                <div className="rounded-lg bg-emerald-100 border border-emerald-300 p-3 text-xs text-emerald-800">
                  <div className="font-semibold flex items-center gap-1.5 mb-1">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Request Logged for HR Review
                  </div>
                  {helpSuccess}
                </div>
              )}

              {helpError && (
                <div className="rounded-lg bg-rose-100 border border-rose-300 p-2.5 text-xs text-rose-800">
                  {helpError}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="danger" size="sm" className="flex-1" onClick={handleReset}>
                  Try Again
                </Button>
                {lastCapturedImage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 bg-white text-blue-700 border-blue-300 hover:bg-blue-50"
                    onClick={() => {
                      setEnrollError(null);
                      setShowEnrollModal(true);
                    }}
                  >
                    <UserPlus className="mr-1.5 h-3.5 w-3.5 text-blue-600" />
                    Quick Enroll My Face
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-slate-700 border-slate-300 hover:bg-slate-100"
                  onClick={() => setShowHelpDrawer(!showHelpDrawer)}
                >
                  <LifeBuoy className="mr-1.5 h-3.5 w-3.5 text-blue-600" />
                  {showHelpDrawer ? "Hide Help" : "Request HR Help"}
                </Button>
              </div>

              {/* Collapsible HR Assistance Ticket Drawer */}
              {showHelpDrawer && !helpSuccess && (
                <form onSubmit={handleSubmitHelp} className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <LifeBuoy className="h-3.5 w-3.5 text-blue-600" />
                      Request HR Biometric Enrollment
                    </span>
                    <Badge variant="brand" className="text-[10px]">Station Ticket</Badge>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    If your face is not yet registered, enter your College Employee ID to notify the HR Officer.
                  </p>

                  <div>
                    <label className="text-[11px] font-medium text-slate-700">Claimed Employee ID / Number</label>
                    <input
                      type="text"
                      placeholder="e.g. EIPC-EMP-001"
                      value={claimedEmpNumber}
                      onChange={(e) => setClaimedEmpNumber(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-700">Reason / Note (optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. New employee requesting biometric enrollment"
                      value={helpReason}
                      onChange={(e) => setHelpReason(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    className="w-full text-xs"
                    isLoading={isSubmittingHelp}
                  >
                    <Send className="mr-1.5 h-3 w-3" />
                    Submit to HR Review Queue
                  </Button>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Authorized HR Officer?</span>
                    <Link
                      href="/employees"
                      className="font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-0.5"
                    >
                      <UserPlus className="h-3 w-3 mr-0.5" />
                      Enroll Face Directly
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </form>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Quick Biometric Face Enrollment Modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-base">Quick Biometric Face Enrollment</h3>
              </div>
              <button
                onClick={() => setShowEnrollModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Register or update your face template directly at this kiosk terminal.
            </p>

            {lastCapturedImage ? (
              <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-900">
                <img
                  src={lastCapturedImage}
                  alt="Captured face snapshot"
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                Please position your face in the camera and click <strong>Scan Face Now</strong> first to capture a frame.
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Select Employee Profile:</label>
              <select
                value={enrollTargetEmpId}
                onChange={(e) => setEnrollTargetEmpId(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 p-2 text-xs font-medium text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employee_number} — {emp.first_name || emp.full_name} {emp.last_name || ""} ({emp.department_name || emp.department || "Staff"})
                  </option>
                ))}
              </select>
            </div>

            {enrollError && (
              <div className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs">
                {enrollError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEnrollModal(false)}
                disabled={isSubmittingEnroll}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmEnrollment}
                isLoading={isSubmittingEnroll}
                disabled={!enrollTargetEmpId || !lastCapturedImage || isSubmittingEnroll}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Confirm Biometric Enrollment
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

