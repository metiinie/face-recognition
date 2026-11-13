"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { CameraCapture } from "@/components/CameraCapture";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { api, RecognitionResult, AttendanceConfirmResponse, StationRecord } from "@/lib/api";
import {
  CheckCircle2,
  XCircle,
  UserCheck,
  ShieldCheck,
  Clock,
  LifeBuoy,
  Send,
  UserPlus,
  ArrowRight,
  LogIn,
  LogOut,
  Wifi,
  WifiOff,
  Hand,
  RefreshCw,
} from "lucide-react";

export default function KioskPage() {
  const [stationId, setStationId] = useState("ST-ICT-01");
  const [stationsList, setStationsList] = useState<StationRecord[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);

  // Touchless & Offline Resilience state (E3, E4)
  const [touchlessAutoPunch, setTouchlessAutoPunch] = useState<boolean>(true);
  const [autoConfirmCountdown, setAutoConfirmCountdown] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [offlineQueueCount, setOfflineQueueCount] = useState<number>(0);
  const [isSyncingQueue, setIsSyncingQueue] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const syncOfflineQueue = useCallback(async () => {
    if (typeof window === "undefined" || isSyncingQueue) return;
    try {
      const stored = localStorage.getItem("eipc_offline_kiosk_queue");
      if (!stored) return;
      const queue: Array<{
        recognition_token: string;
        station_id: string;
        event_type?: "CHECK_IN" | "CHECK_OUT" | "AUTO";
        timestamp: string;
      }> = JSON.parse(stored);
      if (!Array.isArray(queue) || queue.length === 0) return;

      setIsSyncingQueue(true);
      setSyncFeedback(null);
      const remaining: typeof queue = [];
      let syncedCount = 0;

      for (const item of queue) {
        try {
          await api.confirmAttendance({
            recognition_token: item.recognition_token,
            station_id: item.station_id || stationId,
            event_type: item.event_type === "AUTO" ? undefined : item.event_type,
          });
          syncedCount++;
        } catch (err: any) {
          if (
            err.message?.includes("Failed to fetch") ||
            err.message?.includes("NetworkError") ||
            err.message?.includes("Failed to communicate")
          ) {
            remaining.push(item);
          } else {
            console.warn("Discarded unprocessable or expired offline punch:", err);
          }
        }
      }

      localStorage.setItem("eipc_offline_kiosk_queue", JSON.stringify(remaining));
      setOfflineQueueCount(remaining.length);
      if (syncedCount > 0) {
        setSyncFeedback(`Successfully synchronized ${syncedCount} buffered offline punch${syncedCount === 1 ? "" : "es"}.`);
      }
    } catch (err) {
      console.error("Failed to sync offline kiosk queue:", err);
    } finally {
      setIsSyncingQueue(false);
    }
  }, [isSyncingQueue, stationId]);

  useEffect(() => {
    api.getStationDirectory()
      .then((dir) => {
        if (dir.stations && dir.stations.length > 0) {
          setStationsList(dir.stations);
          setStationId(dir.stations[0].station_code);
        }
        if (dir.employees && dir.employees.length > 0) {
          setEmployees(dir.employees);
        }
      })
      .catch((err) => {
        console.warn("Could not load station directory, using defaults:", err);
      });

    // Network & offline queue listeners
    if (typeof window !== "undefined") {
      setIsOnline(navigator.onLine);
      const handleOnline = () => {
        setIsOnline(true);
        syncOfflineQueue();
      };
      const handleOffline = () => setIsOnline(false);
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      try {
        const stored = localStorage.getItem("eipc_offline_kiosk_queue");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setOfflineQueueCount(parsed.length);
            if (navigator.onLine) {
              setTimeout(() => syncOfflineQueue(), 1200);
            }
          }
        }
      } catch {}

      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
  }, [syncOfflineQueue]);

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
  const [showSimTools, setShowSimTools] = useState(false);

  const handleCapture = async (base64Image: string) => {
    setLastCapturedImage(base64Image);
    setIsProcessing(true);
    setFeedbackError(null);
    setPunchError(null);
    setAttendanceOutcome(null);
    setAutoConfirmCountdown(null);

    try {
      const res = await api.recognizeFace({
        image_base64: base64Image,
        station_id: stationId,
        quality_mode: "LIVE_CAPTURE",
      });
      setRecognition(res);

      if (!res.matched) {
        setFeedbackError(res.rejection_message || "Face not recognized. Please adjust position or contact HR.");
      } else if (res.recognition_token && touchlessAutoPunch) {
        // Trigger hands-free auto-confirm countdown
        setAutoConfirmCountdown(2);
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
    setAutoConfirmCountdown(null);

    try {
      const res = await api.recognizeFace({
        biometric_signature: signature,
        station_id: stationId,
        quality_mode: "SIMULATION",
      });
      setRecognition(res);

      if (!res.matched) {
        setFeedbackError(res.rejection_message || `${label}: Match rejected by face engine.`);
      } else if (res.recognition_token && touchlessAutoPunch) {
        setAutoConfirmCountdown(2);
      }
    } catch (err: any) {
      console.error("Simulation failed:", err);
      setFeedbackError(err.message || "Failed to communicate with attendance server.");
    } finally {
      setIsProcessing(false);
    }
  };

  const [selectedAction, setSelectedAction] = useState<"CHECK_IN" | "CHECK_OUT" | null>(null);

  const handleConfirmAttendance = async (action?: "CHECK_IN" | "CHECK_OUT") => {
    if (!recognition?.recognition_token) return;

    setSelectedAction(action || null);
    setIsConfirming(true);
    setPunchError(null);
    setAutoConfirmCountdown(null);
    try {
      const outcome = await api.confirmAttendance({
        recognition_token: recognition.recognition_token,
        station_id: stationId,
        event_type: action,
      });
      setAttendanceOutcome(outcome);
    } catch (err: any) {
      console.error("Attendance confirmation error:", err);
      // Offline fallback buffer (E4)
      if (
        !navigator.onLine ||
        err.message?.includes("Failed to fetch") ||
        err.message?.includes("NetworkError") ||
        err.message?.includes("Failed to communicate")
      ) {
        try {
          const queue = JSON.parse(localStorage.getItem("eipc_offline_kiosk_queue") || "[]");
          queue.push({
            recognition_token: recognition.recognition_token,
            station_id: stationId,
            event_type: action || "AUTO",
            timestamp: new Date().toISOString(),
          });
          localStorage.setItem("eipc_offline_kiosk_queue", JSON.stringify(queue));
          setOfflineQueueCount(queue.length);
          setAttendanceOutcome({
            success: true,
            message: "LAN unavailable. Attendance securely buffered in offline kiosk queue and will sync when reconnected.",
            event_type: action || "CHECK_IN",
            timestamp: new Date().toISOString(),
          });
          return;
        } catch {}
      }
      setPunchError(err.message || "Failed to record attendance event.");
    } finally {
      setIsConfirming(false);
      setSelectedAction(null);
    }
  };

  // Touchless Auto-Confirm Countdown Effect (E3)
  useEffect(() => {
    if (autoConfirmCountdown === null) return;
    if (autoConfirmCountdown > 0) {
      const timer = setTimeout(() => {
        setAutoConfirmCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : null));
      }, 1000);
      return () => clearTimeout(timer);
    } else if (autoConfirmCountdown === 0) {
      setAutoConfirmCountdown(null);
      if (recognition?.recognition_token && !attendanceOutcome && !isConfirming) {
        handleConfirmAttendance();
      }
    }
  }, [autoConfirmCountdown, recognition, attendanceOutcome, isConfirming]);

  const handleReset = () => {
    setRecognition(null);
    setAttendanceOutcome(null);
    setAutoConfirmCountdown(null);
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
    <div className="space-y-5">
      {/* Calm Kiosk Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-slate-900">
                Attendance Kiosk
              </h1>
              {isOnline ? (
                <Badge variant="success" className="gap-1 text-[10px]">
                  <Wifi className="h-3 w-3" />
                  <span>Online</span>
                </Badge>
              ) : (
                <Badge
                  variant="warning"
                  className="gap-1 text-[10px]"
                  title="Terminal is buffering offline punches locally until network recovers."
                >
                  <WifiOff className="h-3 w-3" />
                  <span>Offline {offlineQueueCount > 0 ? `(${offlineQueueCount})` : ""}</span>
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Align your face inside the viewfinder to check in or check out.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {offlineQueueCount > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={syncOfflineQueue}
              disabled={isSyncingQueue || !isOnline}
              className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
              title="Synchronize buffered offline records with attendance server"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncingQueue ? "animate-spin" : ""}`} />
              <span>{isSyncingQueue ? "Syncing..." : `Sync ${offlineQueueCount}`}</span>
            </Button>
          )}

          <button
            type="button"
            onClick={() => {
              setTouchlessAutoPunch(!touchlessAutoPunch);
              setAutoConfirmCountdown(null);
            }}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium border transition-colors ${
              touchlessAutoPunch
                ? "bg-[#EEF2FF] text-[#4338CA] border-indigo-200"
                : "bg-white text-slate-600 border-[#E5E7EB] hover:bg-slate-50"
            }`}
            title="Toggle hands-free automatic attendance confirmation"
          >
            <Hand className="h-3.5 w-3.5" />
            <span>Touchless {touchlessAutoPunch ? "On" : "Off"}</span>
          </button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEnrollError(null);
              setShowEnrollModal(true);
            }}
          >
            <UserPlus className="h-3.5 w-3.5 text-[#4F46E5]" />
            <span>Quick Enroll</span>
          </Button>

          <select
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            aria-label="Terminal Station"
            className="h-8 rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] px-2.5 text-xs font-medium text-slate-800 focus:border-[#4F46E5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
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

      {enrollSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            {enrollSuccess}
          </span>
          <button onClick={() => setEnrollSuccess(null)} className="text-emerald-600 hover:text-emerald-800">
            ✕
          </button>
        </div>
      )}

      {syncFeedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            {syncFeedback}
          </span>
          <button onClick={() => setSyncFeedback(null)} className="text-emerald-700 hover:text-emerald-900 underline text-[11px]">
            Dismiss
          </button>
        </div>
      )}

      {/* Split Workspace: Camera Left, Identity Panel Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Image-3 Inspired Unobstructed Viewfinder */}
        <div className="lg:col-span-7 space-y-2.5">
          <CameraCapture
            onCapture={handleCapture}
            isProcessing={isProcessing}
            autoScanIntervalMs={1600}
            guideText="Position face inside the corner viewfinder"
            captureButtonText="Manual Shot"
            scanState={
              isProcessing
                ? "scanning"
                : recognition?.matched
                ? "matched"
                : feedbackError
                ? "error"
                : "idle"
            }
          />

          <div className="flex items-center justify-between px-1 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              <span>Anti-spoof & liveness verification active</span>
            </span>
            <button
              type="button"
              onClick={() => setShowSimTools(!showSimTools)}
              className="text-slate-500 hover:text-slate-900 font-medium transition-colors"
            >
              {showSimTools ? "Hide test presets" : "Test presets"}
            </button>
          </div>

          {showSimTools && (
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-700">
                  Simulation Presets (Testing)
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Mock Biometrics</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isProcessing}
                  onClick={() => handleSimulateScan("FACE_SIG_EIPC-EMP-001", "Abebe Kebede")}
                >
                  Abebe Kebede
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isProcessing}
                  onClick={() => handleSimulateScan("FACE_SIG_EIPC-EMP-002", "Hanna Mekonnen")}
                >
                  Hanna Mekonnen
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isProcessing}
                  onClick={() => handleSimulateScan("FACE_SIG_EIPC-EMP-003", "Chaltu Girma")}
                >
                  Chaltu Girma
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isProcessing}
                  onClick={() => handleSimulateScan("UNKNOWN_PERSON_001", "Unknown Visitor")}
                  className="text-amber-700 border-amber-200 hover:bg-amber-50"
                >
                  Unknown Visitor
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isProcessing}
                  onClick={() => handleSimulateScan("POOR_LIGHTING", "Poor Lighting")}
                  className="text-rose-700 border-rose-200 hover:bg-rose-50"
                >
                  Obstructed / Glare
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Calm Confirmation Panel */}
        <div className="lg:col-span-5 space-y-4">
          {/* State 1: Idle Ready */}
          {!recognition && !feedbackError && (
            <Card className="p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#EAECEF] bg-[#FAFBFD] text-[#4F46E5]">
                <UserCheck className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold text-slate-900">Ready for Verification</h2>
              <p className="mt-1.5 text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                Look naturally toward the camera. Your frame is verified automatically for liveness and identity.
              </p>
              <div className="mt-5 pt-4 border-t border-[#EAECEF] flex items-center justify-between text-[11px] text-slate-400">
                <span>Touchless: {touchlessAutoPunch ? "2s Auto-Punch" : "Manual Confirm"}</span>
                <button
                  type="button"
                  onClick={() => {
                    setEnrollError(null);
                    setShowEnrollModal(true);
                  }}
                  className="font-medium text-[#4F46E5] hover:underline"
                >
                  Quick Enrollment →
                </button>
              </div>
            </Card>
          )}

          {/* State 2: Matched & Awaiting Confirmation */}
          {recognition?.matched && recognition.employee && !attendanceOutcome && (
            <Card className="p-6 border-emerald-200">
              <div className="flex items-center justify-between gap-2 pb-4 border-b border-[#EAECEF]">
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Identity Verified</span>
                </Badge>
                {recognition.latency_ms && (
                  <span className="font-mono text-[11px] font-medium text-slate-500 tabular-nums">
                    {recognition.latency_ms} ms
                  </span>
                )}
              </div>

              {/* Employee Profile Header */}
              <div className="mt-5 flex flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#EEF2FF] text-[#4338CA] text-lg font-semibold ring-2 ring-emerald-500/40 ring-offset-2">
                  {recognition.employee.first_name[0]}
                  {recognition.employee.last_name[0]}
                </div>
                <h2 className="mt-3 text-lg font-semibold tracking-tight text-slate-900">
                  {recognition.employee.first_name} {recognition.employee.last_name}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {recognition.employee.department_name} · {recognition.employee.employee_number} ·{" "}
                  {recognition.employee.job_category}
                </p>
              </div>

              {/* Metric Strip */}
              <div className="mt-5 grid grid-cols-2 gap-2.5">
                <div className="rounded-lg border border-[#EAECEF] bg-[#FAFBFD] p-3 text-center">
                  <span className="text-[11px] text-slate-500 block">Confidence</span>
                  <span className="mt-0.5 block text-sm font-semibold text-slate-900 tabular-nums">
                    {recognition.match_score ? `${(recognition.match_score * 100).toFixed(1)}%` : "N/A"}
                  </span>
                </div>
                <div className="rounded-lg border border-[#EAECEF] bg-[#FAFBFD] p-3 text-center">
                  <span className="text-[11px] text-slate-500 block">Liveness</span>
                  <span className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>PASS</span>
                  </span>
                </div>
              </div>

              {punchError && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 flex items-center gap-2">
                  <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{punchError}</span>
                </div>
              )}

              {touchlessAutoPunch && autoConfirmCountdown !== null && (
                <div className="mt-4 rounded-lg border border-indigo-200 bg-[#EEF2FF] px-3 py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 font-medium text-[#4338CA] tabular-nums">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Auto-confirming in {autoConfirmCountdown}s</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoConfirmCountdown(null)}
                    className="text-[11px] font-medium text-[#4F46E5] hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Stacked Check-In / Check-Out Actions */}
              <div className="mt-5 space-y-2.5">
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={() => handleConfirmAttendance("CHECK_IN")}
                  isLoading={isConfirming && selectedAction === "CHECK_IN"}
                  disabled={isConfirming}
                >
                  <LogIn className="h-4 w-4" />
                  <span>Confirm Check-In (መግቢያ)</span>
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full"
                  onClick={() => handleConfirmAttendance("CHECK_OUT")}
                  isLoading={isConfirming && selectedAction === "CHECK_OUT"}
                  disabled={isConfirming}
                >
                  <LogOut className="h-4 w-4 text-slate-600" />
                  <span>Check-Out (መውጫ)</span>
                </Button>
              </div>

              <div className="mt-4 pt-3 border-t border-[#EAECEF] flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isConfirming}
                  className="text-slate-500 hover:text-slate-900 font-medium"
                >
                  Re-scan
                </button>
                {lastCapturedImage && (
                  <button
                    type="button"
                    onClick={() => {
                      setEnrollError(null);
                      setShowEnrollModal(true);
                    }}
                    disabled={isConfirming}
                    className="text-[#4F46E5] hover:underline font-medium"
                  >
                    Not you? Re-enroll
                  </button>
                )}
              </div>
            </Card>
          )}

          {/* State 3: Attendance Recorded Confirmation */}
          {attendanceOutcome && (
            <Card className="p-6 text-center border-emerald-200">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <Badge variant="brand">
                {attendanceOutcome.event_type === "CHECK_IN" ? "CHECK-IN RECORDED" : "CHECK-OUT RECORDED"}
              </Badge>
              <h2 className="mt-3 text-base font-semibold text-slate-900">{attendanceOutcome.message}</h2>
              <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
                {new Date(attendanceOutcome.timestamp).toLocaleTimeString()} EAT
              </p>

              {attendanceOutcome.is_late && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  Late arrival recorded: {attendanceOutcome.minutes_late} minute(s) past shift start.
                </div>
              )}

              <Button variant="primary" size="md" className="mt-5 w-full" onClick={handleReset}>
                Done · Next Person
              </Button>
            </Card>
          )}

          {/* State 4: Rejection / Unrecognized Face */}
          {feedbackError && !recognition?.matched && (
            <Card className="p-6 space-y-4 border-rose-200">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 border border-rose-200 text-rose-600 shrink-0">
                    <XCircle className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Verification Unmatched</h3>
                    {recognition?.rejection_code && (
                      <span className="font-mono text-[10px] text-rose-600">
                        {recognition.rejection_code}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-600 bg-[#FAFBFD] p-3 rounded-lg border border-[#EAECEF] leading-relaxed">
                {feedbackError}
              </p>

              {recognition && typeof recognition.match_score === "number" && recognition.match_score > 0 && (
                <div className="flex items-center justify-between text-[11px] text-slate-500 bg-[#FAFBFD] px-3 py-2 rounded-lg border border-[#EAECEF] tabular-nums">
                  <span>
                    Score: <strong className="font-mono text-slate-900">{(recognition.match_score * 100).toFixed(1)}%</strong>
                  </span>
                  <span>
                    Threshold: <strong className="font-mono text-slate-700">35.0%</strong>
                  </span>
                </div>
              )}

              {helpSuccess && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                  <div className="font-medium flex items-center gap-1.5 mb-0.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Submitted to HR Review Queue</span>
                  </div>
                  {helpSuccess}
                </div>
              )}

              {helpError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                  {helpError}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" className="flex-1" onClick={handleReset}>
                  Try Again
                </Button>
                {lastCapturedImage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setEnrollError(null);
                      setShowEnrollModal(true);
                    }}
                  >
                    <UserPlus className="h-3.5 w-3.5 text-[#4F46E5]" />
                    <span>Quick Enroll</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setShowHelpDrawer(!showHelpDrawer)}
                >
                  <LifeBuoy className="h-3.5 w-3.5" />
                  <span>{showHelpDrawer ? "Hide Help" : "HR Help"}</span>
                </Button>
              </div>

              {showHelpDrawer && !helpSuccess && (
                <form
                  onSubmit={handleSubmitHelp}
                  className="rounded-xl border border-[#EAECEF] bg-[#FAFBFD] p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      Request HR Biometric Enrollment
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      Ticket
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Enter your College Employee ID to notify HR for biometric registration.
                  </p>

                  <div>
                    <label className="text-[11px] font-medium text-slate-700">Employee ID</label>
                    <input
                      type="text"
                      placeholder="e.g. EIPC-EMP-001"
                      value={claimedEmpNumber}
                      onChange={(e) => setClaimedEmpNumber(e.target.value)}
                      className="mt-1 h-8 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-700">Note (optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Requesting face enrollment"
                      value={helpReason}
                      onChange={(e) => setHelpReason(e.target.value)}
                      className="mt-1 h-8 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
                    />
                  </div>

                  <Button type="submit" variant="primary" size="sm" className="w-full" isLoading={isSubmittingHelp}>
                    <Send className="h-3 w-3" />
                    <span>Submit Request</span>
                  </Button>

                  <div className="pt-2 border-t border-[#EAECEF] flex items-center justify-between text-[11px] text-slate-500">
                    <span>HR Staff?</span>
                    <Link
                      href="/employees"
                      className="font-medium text-[#4F46E5] hover:underline inline-flex items-center gap-1"
                    >
                      <span>Open Directory</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </form>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Quick Biometric Enrollment Modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#EAECEF] pb-3">
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Quick Biometric Enrollment</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Link the captured snapshot to an active staff profile.
                </p>
              </div>
              <button
                onClick={() => setShowEnrollModal(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {lastCapturedImage ? (
              <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden border border-[#E5E7EB] bg-[#0B0F17]">
                <img
                  src={lastCapturedImage}
                  alt="Captured face snapshot"
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                Position your face in the camera and click <strong>Manual Shot</strong> first to capture a frame.
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700">Employee Profile</label>
              <select
                value={enrollTargetEmpId}
                onChange={(e) => setEnrollTargetEmpId(e.target.value ? Number(e.target.value) : "")}
                className="h-9 w-full rounded-lg border border-[#E5E7EB] px-2.5 text-xs font-medium text-slate-800 bg-white focus:border-[#4F46E5] focus:outline-none focus:ring-2 focus:ring-indigo-500/15"
              >
                <option value="">— Select Employee Name &amp; ID —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employee_number} — {emp.first_name || emp.full_name} {emp.last_name || ""} (
                    {emp.department_name || emp.department || "Staff"})
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
                variant="primary"
                size="sm"
                onClick={handleConfirmEnrollment}
                isLoading={isSubmittingEnroll}
                disabled={!enrollTargetEmpId || !lastCapturedImage || isSubmittingEnroll}
              >
                Save Enrollment
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

