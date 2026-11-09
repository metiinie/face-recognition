"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  api,
  ContinuousFaceResult,
  ContinuousEntranceFrameResponse,
  GatePassageRecord,
  GateStatusResponse,
  StationRecord,
  EmployeeRecord,
} from "@/lib/api";
import { getEntranceSocket } from "@/lib/socket";
import {
  Radio,
  Camera,
  Play,
  Pause,
  RefreshCw,
  Users,
  CheckCircle2,
  Clock,
  ArrowRight,
  ShieldAlert,
  Zap,
  Sparkles,
  Building2,
  AlertCircle,
  Volume2,
  VolumeX,
  UserCheck,
  UserX,
  Activity,
  Layers,
  UserPlus,
  FlipHorizontal,
  X,
} from "lucide-react";

export default function ContinuousEntrancePage() {
  const [stations, setStations] = useState<StationRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>("ST-GATE-01");
  const [gateMode, setGateMode] = useState<"AUTO_DETECT" | "IN" | "OUT">("AUTO_DETECT");
  const [cooldownSec, setCooldownSec] = useState<number>(20);

  // Video and Stream state
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isMirrored, setIsMirrored] = useState<boolean>(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Telemetry & metrics
  const [fps, setFps] = useState<number>(0);
  const [latencyMs, setLatencyMs] = useState<number>(85);
  const [detectedFaces, setDetectedFaces] = useState<ContinuousFaceResult[]>([]);
  const [gateStatus, setGateStatus] = useState<GateStatusResponse | null>(null);
  const [recentPassages, setRecentPassages] = useState<GatePassageRecord[]>([]);
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false);
  const [transportMode, setTransportMode] = useState<"WEBSOCKET" | "HTTP_FALLBACK">("HTTP_FALLBACK");
  const streamDimsRef = useRef<{ w: number; h: number }>({ w: 480, h: 360 });

  // Simulation & Action Feedback Banners
  const [simMessage, setSimMessage] = useState<{ type: "success" | "warning"; text: string } | null>(null);

  // Quick Face Enrollment Modal State
  const [showEnrollModal, setShowEnrollModal] = useState<boolean>(false);
  const [enrollTargetEmpId, setEnrollTargetEmpId] = useState<number | "">("");
  const [enrollSnapshotB64, setEnrollSnapshotB64] = useState<string | null>(null);
  const [isSubmittingEnroll, setIsSubmittingEnroll] = useState<boolean>(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isStreamingRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);
  const frameCountRef = useRef<number>(0);
  const lastFpsTimeRef = useRef<number>(Date.now());

  // 1. Initial Data Fetch
  const fetchGateData = useCallback(async () => {
    try {
      const status = await api.getGateStatus(selectedStation);
      setGateStatus(status);
      setRecentPassages(status.recent_passages || []);
      if (status.gate_mode) {
        setGateMode(status.gate_mode as any);
      }
    } catch (err: any) {
      console.warn("Could not load gate status:", err);
    }

    try {
      const dir = await api.getStationDirectory();
      if (dir.stations && dir.stations.length > 0) {
        setStations(dir.stations);
      }
      if (dir.employees && dir.employees.length > 0) {
        setEmployees(dir.employees);
      }
    } catch (err: any) {
      console.warn("Could not load station directory:", err);
    }
  }, [selectedStation]);

  useEffect(() => {
    fetchGateData();
  }, [fetchGateData]);

  // WebSocket Connection Lifecycle
  useEffect(() => {
    const socket = getEntranceSocket();

    const onConnect = () => {
      setIsWsConnected(true);
      setTransportMode("WEBSOCKET");
      socket.emit("join_station", { station_code: selectedStation });
    };

    const onDisconnect = () => {
      setIsWsConnected(false);
      setTransportMode("HTTP_FALLBACK");
    };

    const onPassageEvent = (data: any) => {
      if (data && data.actions && data.actions.length > 0) {
        playSoundChime("success");
        fetchGateData();
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("passage_event", onPassageEvent);

    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("passage_event", onPassageEvent);
      socket.emit("leave_station", { station_code: selectedStation });
      socket.disconnect();
    };
  }, [selectedStation, fetchGateData]);

  // Audio Chime Synthesizer
  const playSoundChime = (type: "success" | "warning") => {
    if (!soundEnabled || typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "success") {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880.0, ctx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } else {
        osc.frequency.setValueAtTime(320.0, ctx.currentTime);
        osc.frequency.setValueAtTime(280.0, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.28);
        osc.start();
        osc.stop(ctx.currentTime + 0.28);
      }
    } catch {
      // Audio autoplay policy fallback
    }
  };

  // 2. Start / Stop Camera Stream
  const startCamera = useCallback(async () => {
    try {
      setStreamError(null);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Webcam access is not supported by your browser environment.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user", frameRate: { ideal: 30 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        isStreamingRef.current = true;
        setIsStreaming(true);
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(() => {});
        };
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      setStreamError("Unable to access optical camera device: " + (err.message || err.name));
      isStreamingRef.current = false;
      setIsStreaming(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    isStreamingRef.current = false;
    setIsStreaming(false);
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    const canvas = overlayCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    setDetectedFaces([]);
  }, []);

  // Automatically start optical camera stream when Continuous Entrance page mounts
  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  // Draw Bounding Boxes on Overlay Canvas
  const drawOverlays = useCallback((faces: ContinuousFaceResult[]) => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sw = streamDimsRef.current.w || canvas.width;
    const sh = streamDimsRef.current.h || canvas.height;
    const scaleX = canvas.width / sw;
    const scaleY = canvas.height / sh;

    faces.forEach((face) => {
      const bx = Math.round(face.bounding_box.x * scaleX);
      const by = Math.round(face.bounding_box.y * scaleY);
      const bw = Math.round(face.bounding_box.w * scaleX);
      const bh = Math.round(face.bounding_box.h * scaleY);
      const drawX = isMirrored ? Math.max(0, canvas.width - (bx + bw)) : bx;
      const y = by;
      const w = bw;
      const h = bh;

      // Color scheme based on status
      let strokeColor = "#10b981"; // emerald for confirmed
      let fillColor = "rgba(16, 185, 129, 0.12)";
      let tagText = "PASSAGE CONFIRMED";

      if (face.action_status === "COOLDOWN_ACTIVE") {
        strokeColor = "#f59e0b"; // amber
        fillColor = "rgba(245, 158, 11, 0.12)";
        tagText = "COOLDOWN (PASSAGE LOGGED)";
      } else if (face.action_status === "ACQUIRING_TRACK") {
        strokeColor = "#0284c7"; // sky blue
        fillColor = "rgba(2, 132, 199, 0.12)";
        tagText = `TRACKING (${face.frames_seen || 1}/2 FRAMES)`;
      } else if (face.action_status === "ALREADY_PUNCHED_IN_PASSAGE") {
        strokeColor = "#059669"; // green
        fillColor = "rgba(5, 150, 105, 0.12)";
        tagText = "PASSAGE AUTHORIZED";
      } else if (face.action_status === "SPOOF_BLOCKED") {
        strokeColor = "#dc2626"; // red
        fillColor = "rgba(220, 38, 38, 0.22)";
        tagText = "SPOOF ATTACK BLOCKED";
      } else if (face.action_status === "CONSENT_BLOCKED" || face.status === "CONSENT_NOT_VERIFIED") {
        strokeColor = "#dc2626"; // red
        fillColor = "rgba(220, 38, 38, 0.22)";
        tagText = "CONSENT NOT VERIFIED (BLOCKED)";
      } else if (face.action_status === "STATIONARY_LINGER") {
        strokeColor = "#7c3aed"; // violet
        fillColor = "rgba(124, 58, 237, 0.12)";
        tagText = "STEP FORWARD TO REGISTER";
      } else if (face.action_status === "ALREADY_CHECKED_IN") {
        strokeColor = "#0891b2"; // cyan
        fillColor = "rgba(8, 145, 178, 0.12)";
        tagText = "ALREADY CHECKED IN";
      } else if (face.action_status === "NO_OPEN_SESSION") {
        strokeColor = "#db2777"; // pink
        fillColor = "rgba(219, 39, 119, 0.12)";
        tagText = "NO OPEN SESSION (CANNOT EXIT)";
      } else if (face.status === "UNKNOWN_FACE" || face.action_status === "UNKNOWN_VISITOR") {
        strokeColor = "#f43f5e"; // rose
        fillColor = "rgba(244, 63, 94, 0.15)";
        tagText = "UNKNOWN VISITOR";
      } else if (face.status === "UNCERTAIN_MATCH") {
        strokeColor = "#eab308"; // yellow
        fillColor = "rgba(234, 179, 8, 0.12)";
        tagText = "UNCERTAIN CANDIDATE";
      }

      // Draw box with rounded aesthetic
      ctx.lineWidth = 3;
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = fillColor;
      ctx.strokeRect(drawX, y, w, h);
      ctx.fillRect(drawX, y, w, h);

      // Corner accent markers
      const cornerLen = 14;
      ctx.lineWidth = 4;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(drawX, y + cornerLen);
      ctx.lineTo(drawX, y);
      ctx.lineTo(drawX + cornerLen, y);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(drawX + w - cornerLen, y);
      ctx.lineTo(drawX + w, y);
      ctx.lineTo(drawX + w, y + cornerLen);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(drawX, y + h - cornerLen);
      ctx.lineTo(drawX, y + h);
      ctx.lineTo(drawX + cornerLen, y + h);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(drawX + w - cornerLen, y + h);
      ctx.lineTo(drawX + w, y + h);
      ctx.lineTo(drawX + w, y + h - cornerLen);
      ctx.stroke();

      // Top Tag Badge
      const name = face.employee ? face.employee.full_name : tagText;
      const sub = face.employee
        ? `${face.employee.employee_number} • ${Math.round(face.recognition_score * 100)}% • ${face.motion_direction || "APPROACHING"}`
        : `Track #${face.track_id} • ${face.motion_direction || "ACQUIRING"}`;

      ctx.fillStyle = strokeColor;
      ctx.fillRect(drawX, Math.max(0, y - 26), Math.max(130, w * 0.9), 26);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(name, drawX + 6, Math.max(14, y - 12));

      ctx.font = "9px monospace";
      ctx.fillText(sub, drawX + 6, Math.max(24, y - 2));

      // Action punch indicator at bottom of box
      if (face.attendance_action) {
        ctx.fillStyle = face.attendance_action === "CHECK_IN" ? "#047857" : "#1d4ed8";
        ctx.fillRect(drawX, y + h, Math.max(100, w * 0.8), 20);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px monospace";
        ctx.fillText(
          `${face.attendance_action} ${face.is_late ? "(LATE)" : "(ON TIME)"}`,
          drawX + 6,
          y + h + 14
        );
      }
    });
  }, [isMirrored]);

  // Re-render overlays immediately when mirror orientation is toggled
  useEffect(() => {
    if (detectedFaces.length > 0) {
      drawOverlays(detectedFaces);
    }
  }, [isMirrored, detectedFaces, drawOverlays]);

  const clearOverlays = () => {
    const canvas = overlayCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  // 3. Process Live Optical Frame (WebSocket Streaming + Optimized Bandwidth)
  const processLiveFrame = useCallback(async () => {
    if (!videoRef.current || videoRef.current.readyState < 2 || isProcessingRef.current || !isStreamingRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Bandwidth Optimization: Downscale frame to optimal 480px width for network transmission
    // Reduces frame payload size by over 80% while preserving high-accuracy face detection
    const targetW = 480;
    const aspect = (video.videoHeight || 480) / (video.videoWidth || 640);
    const targetH = Math.round(targetW * aspect);
    streamDimsRef.current = { w: targetW, h: targetH };

    canvas.width = targetW;
    canvas.height = targetH;

    if (overlayCanvasRef.current) {
      overlayCanvasRef.current.width = video.videoWidth || 640;
      overlayCanvasRef.current.height = video.videoHeight || 480;
    }

    ctx.drawImage(video, 0, 0, targetW, targetH);
    const base64Image = canvas.toDataURL("image/jpeg", 0.68);

    isProcessingRef.current = true;
    setIsProcessing(true);
    const startTime = performance.now();

    try {
      const socket = getEntranceSocket();
      let res: ContinuousEntranceFrameResponse;

      // Stream over WebSocket if connected, otherwise fallback seamlessly to HTTP
      if (socket.connected) {
        res = await new Promise<ContinuousEntranceFrameResponse>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("WS timeout")), 2500);
          socket.emit(
            "process_frame",
            {
              station_code: selectedStation,
              image_base64: base64Image,
              gate_mode: gateMode,
            },
            (data: ContinuousEntranceFrameResponse) => {
              clearTimeout(timeout);
              resolve(data);
            }
          );
        }).catch(async () => {
          setTransportMode("HTTP_FALLBACK");
          return await api.processContinuousEntranceFrame({
            station_code: selectedStation,
            image_base64: base64Image,
            gate_mode: gateMode,
          });
        });
      } else {
        res = await api.processContinuousEntranceFrame({
          station_code: selectedStation,
          image_base64: base64Image,
          gate_mode: gateMode,
        });
      }

      const tookMs = Math.round(performance.now() - startTime);
      setLatencyMs(tookMs);
      setDetectedFaces(res.faces);
      drawOverlays(res.faces);

      // Play audio chime if action was confirmed or unknown
      const hasConfirmed = res.faces.some((f) => f.action_status === "CONFIRMED");
      const hasUnknown = res.faces.some((f) => f.action_status === "UNKNOWN_VISITOR");
      if (hasConfirmed) playSoundChime("success");
      else if (hasUnknown) playSoundChime("warning");

      // Update FPS counter
      frameCountRef.current += 1;
      const now = Date.now();
      if (now - lastFpsTimeRef.current >= 1000) {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      // If new passages were confirmed, refresh gate status
      if (res.summary_actions && res.summary_actions.length > 0) {
        fetchGateData();
      }
      setStreamError(null);
    } catch (err: any) {
      console.warn("Continuous frame processing error:", err);
      setStreamError(err.message || "Frame recognition request failed.");
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [selectedStation, gateMode, drawOverlays, fetchGateData]);

  // Periodic capture loop when streaming (smooth, non-overlapping)
  useEffect(() => {
    isStreamingRef.current = isStreaming;
    if (!isStreaming) {
      clearOverlays();
      setDetectedFaces([]);
      return;
    }

    let active = true;
    let timerId: NodeJS.Timeout | null = null;

    const runLoop = async () => {
      if (!active || !isStreamingRef.current) return;
      await processLiveFrame();
      if (active && isStreamingRef.current) {
        // High-performance streaming: 350ms on WebSocket vs 550ms on HTTP fallback
        const interval = isWsConnected ? 350 : 550;
        timerId = setTimeout(runLoop, interval);
      }
    };

    runLoop();

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [isStreaming, isWsConnected, processLiveFrame]);

  // 4. Change Gate Configuration
  const handleModeChange = async (mode: "AUTO_DETECT" | "IN" | "OUT") => {
    setGateMode(mode);
    try {
      await api.configureGate({
        station_code: selectedStation,
        gate_mode: mode,
        cooldown_sec: cooldownSec,
      });
      setSimMessage({
        type: "success",
        text: mode === "AUTO_DETECT"
          ? "Gate mode set to Auto-Detect with accidental checkout protection (15m debounce)."
          : `Gate mode switched to ${mode}. Directional punches will apply automatically.`,
      });
    } catch (err: any) {
      console.error("Failed to update gate mode:", err);
    }
  };

  // 5. Multi-Person Crowd Simulation Triggers
  const runSimulation = async (simulatedStaff: string[], label: string) => {
    setIsProcessing(true);
    setSimMessage(null);
    try {
      const startTime = performance.now();
      const res = await api.simulateGatePassage({
        station_code: selectedStation,
        simulated_staff: simulatedStaff,
        gate_mode: gateMode,
      });

      const tookMs = Math.round(performance.now() - startTime);
      setLatencyMs(tookMs);
      setDetectedFaces(res.faces);

      if (overlayCanvasRef.current) {
        overlayCanvasRef.current.width = 640;
        overlayCanvasRef.current.height = 480;
      }
      drawOverlays(res.faces);

      const hasConfirmed = res.faces.some((f) => f.action_status === "CONFIRMED");
      const hasUnknown = res.faces.some((f) => f.action_status === "UNKNOWN_VISITOR");
      if (hasConfirmed) playSoundChime("success");
      else if (hasUnknown) playSoundChime("warning");

      setSimMessage({
        type: "success",
        text: `Simulation executed: ${label}. Results: ${res.summary_actions.join(", ") || "No new punch recorded."}`,
      });
      fetchGateData();
    } catch (err: any) {
      setSimMessage({
        type: "warning",
        text: `Simulation error: ${err.message || "Failed to trigger passage."}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // 6. Quick Live Face Enrollment
  const handleOpenQuickEnroll = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const b64 = canvas.toDataURL("image/jpeg", 0.92);
        setEnrollSnapshotB64(b64);
      }
    }
    if (employees.length > 0 && !enrollTargetEmpId) {
      setEnrollTargetEmpId(employees[0].id);
    }
    setEnrollError(null);
    setShowEnrollModal(true);
  };

  const handleConfirmEnrollment = async () => {
    if (!enrollTargetEmpId || !enrollSnapshotB64) return;
    setIsSubmittingEnroll(true);
    setEnrollError(null);
    try {
      await api.quickEnrollFace({
        employee_id: Number(enrollTargetEmpId),
        image_base64: enrollSnapshotB64,
      });
      setShowEnrollModal(false);
      setSimMessage({
        type: "success",
        text: `Biometric template successfully enrolled! The continuous gate will now recognize your face automatically.`,
      });
      fetchGateData();
    } catch (err: any) {
      setEnrollError(err.message || "Failed to enroll template. Please ensure your face is well lit.");
    } finally {
      setIsSubmittingEnroll(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Offscreen frame capture canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Top Header & Gate Controller Bar */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Screen V2 — Continuous-Entrance Multi-Face Gate
            </h1>
            <Badge variant="brand" className="text-xs">Option B • Autonomous</Badge>
            {isWsConnected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-500/20">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                WebSocket Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 border border-amber-500/20">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                HTTP Mode
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Real-time, high-throughput multi-person face tracking, automated hands-free check-ins/check-outs, and gate pass-through cooldown.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Station Selector */}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-sm">
            <Building2 className="h-3.5 w-3.5 text-blue-600" />
            <select
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value)}
              className="font-mono font-medium text-slate-800 bg-transparent focus:outline-none"
            >
              {stations.length > 0 ? (
                stations.map((s) => (
                  <option key={s.id} value={s.station_code}>
                    {s.station_code} — {s.name}
                  </option>
                ))
              ) : (
                <option value="ST-GATE-01">ST-GATE-01 — Main Campus Gate</option>
              )}
            </select>
          </div>

          {/* Direction Mode Buttons */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs shadow-sm">
            <button
              onClick={() => handleModeChange("IN")}
              className={`rounded-md px-3 py-1 font-medium transition-all ${
                gateMode === "IN"
                  ? "bg-white text-emerald-700 shadow-sm font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Entry (Check-In)
            </button>
            <button
              onClick={() => handleModeChange("OUT")}
              className={`rounded-md px-3 py-1 font-medium transition-all ${
                gateMode === "OUT"
                  ? "bg-white text-blue-700 shadow-sm font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Exit (Check-Out)
            </button>
            <button
              onClick={() => handleModeChange("AUTO_DETECT")}
              className={`rounded-md px-3 py-1 font-medium transition-all ${
                gateMode === "AUTO_DETECT"
                  ? "bg-white text-indigo-700 shadow-sm font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Auto-Detect
            </button>
          </div>

          {/* Sound Toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSoundEnabled(!soundEnabled)}
            title={soundEnabled ? "Mute Gate Chime" : "Enable Gate Chime"}
          >
            {soundEnabled ? (
              <Volume2 className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <VolumeX className="h-3.5 w-3.5 text-slate-400" />
            )}
          </Button>

          <Button variant="outline" size="sm" onClick={fetchGateData}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Simulation / Feedback Alert */}
      {simMessage && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
            simMessage.type === "success"
              ? "bg-emerald-50 text-emerald-900 border-emerald-200"
              : "bg-amber-50 text-amber-900 border-amber-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {simMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
            )}
            <span className="font-medium">{simMessage.text}</span>
          </div>
          <button
            onClick={() => setSimMessage(null)}
            className="text-xs underline font-semibold hover:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Camera Stream Error */}
      {streamError && (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-900 text-xs flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{streamError}</span>
        </div>
      )}

      {/* Main Grid: Left Viewport (Canvas), Right Gate Passage Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Continuous Multi-Face Camera (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <Card className="bg-slate-950 border-slate-900 shadow-2xl overflow-hidden relative">
            {/* Viewport Frame */}
            <div className="relative aspect-[4/3] w-full bg-slate-900 flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover transition-transform duration-150 ${
                  isMirrored ? "-scale-x-100" : ""
                } ${isStreaming ? "block" : "opacity-0 pointer-events-none absolute inset-0"}`}
              />

              {/* Real-time Overlays Canvas */}
              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none z-10"
              />

              {/* Offline Placeholder */}
              {!isStreaming && (
                <div className="text-center p-6 space-y-3 z-0">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800 text-blue-400 border border-slate-700/80 shadow-lg">
                    <Radio className="h-8 w-8 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">
                      Continuous Entrance Gate Viewport
                    </h3>
                    <p className="text-xs text-slate-500 max-w-sm mt-1">
                      Ready for optical multi-face tracking or simulated multi-person crowd pass-through.
                    </p>
                  </div>
                  <Button onClick={startCamera} size="sm" className="bg-blue-600 hover:bg-blue-700">
                    <Play className="mr-1.5 h-3.5 w-3.5" /> Start Live Optical Stream
                  </Button>
                </div>
              )}

              {/* Overlaid Live Telemetry Pills */}
              {isStreaming && (
                <>
                  {/* Top-Left: Camera status & Latency & Transport */}
                  <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
                    <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] font-mono text-emerald-400 backdrop-blur-md border border-emerald-500/30">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                      AI TRACKING • {fps} FPS
                    </span>
                    <span className="rounded-md bg-black/60 px-2 py-1 text-[11px] font-mono text-slate-300 backdrop-blur-md border border-white/10">
                      <Zap className="inline h-3 w-3 text-amber-400 mr-1" />
                      {latencyMs}ms
                    </span>
                    <span
                      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-mono backdrop-blur-md border ${
                        isWsConnected
                          ? "bg-black/60 text-emerald-300 border-emerald-500/40"
                          : "bg-black/60 text-amber-300 border-amber-500/40"
                      }`}
                    >
                      {isWsConnected ? (
                        <>
                          <Zap className="h-3 w-3 text-emerald-400 fill-emerald-400" />
                          WS STREAM
                        </>
                      ) : (
                        <>
                          <Radio className="h-3 w-3 text-amber-400" />
                          HTTP FALLBACK
                        </>
                      )}
                    </span>
                  </div>

                  {/* Top-Right: Faces Detected Count */}
                  <div className="absolute top-3 right-3 z-20">
                    <Badge variant={detectedFaces.length > 0 ? "success" : "brand"} className="backdrop-blur-md text-xs py-1">
                      <Users className="h-3.5 w-3.5 mr-1" />
                      {detectedFaces.length} Face{detectedFaces.length === 1 ? "" : "s"} Tracked
                    </Badge>
                  </div>
                </>
              )}

              {/* Bottom Control Bar */}
              {isStreaming && (
                <div className="absolute bottom-3 inset-x-3 z-20 flex items-center justify-between bg-black/70 p-2 rounded-xl backdrop-blur-md border border-white/10">
                  <div className="flex items-center gap-2 text-xs text-slate-300 font-mono">
                    <span className="text-blue-400 font-semibold">{selectedStation}</span>
                    <span>•</span>
                    <span className="text-emerald-400">Mode: {gateMode}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsMirrored(!isMirrored)}
                      className="text-xs h-7 bg-white/10 hover:bg-white/20 text-white border-white/20"
                      title={isMirrored ? "Switch to direct gate camera view" : "Switch to mirrored natural selfie view"}
                    >
                      <FlipHorizontal className="h-3 w-3 mr-1 text-cyan-400" />
                      {isMirrored ? "Mirrored" : "Direct"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleOpenQuickEnroll}
                      className="text-xs h-7 bg-white/10 hover:bg-white/20 text-white border-white/20"
                    >
                      <UserPlus className="h-3 w-3 mr-1 text-emerald-400" /> Enroll My Face
                    </Button>
                    <Button size="sm" variant="danger" onClick={stopCamera} className="text-xs h-7">
                      <Pause className="h-3 w-3 mr-1" /> Stop Stream
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Quick Crowd & Passage Simulation Sandbox */}
          <Card className="bg-slate-50 border-slate-200 shadow-sm">
            <CardHeader className="py-3 px-4 bg-white border-b border-slate-100 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-xs font-bold flex items-center gap-1.5 text-slate-800">
                  <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                  Option B Multi-Person Simulation Sandbox
                </CardTitle>
                <CardDescription className="text-[11px]">
                  Test continuous multi-face detection, cooldown and autonomous punching without a camera.
                </CardDescription>
              </div>
              <Badge variant="brand" className="text-[10px]">Developer Rig</Badge>
            </CardHeader>
            <CardContent className="p-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runSimulation(["EIPC-EMP-001", "EIPC-EMP-002"], "2 Staff Entering Together")}
                  isLoading={isProcessing}
                  className="text-[11px] h-8 justify-center bg-white"
                >
                  <Users className="h-3 w-3 mr-1 text-emerald-600" />
                  Abebe + Hanna
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runSimulation(["EIPC-EMP-003"], "Solo Staff Fast Passage")}
                  isLoading={isProcessing}
                  className="text-[11px] h-8 justify-center bg-white"
                >
                  <UserCheck className="h-3 w-3 mr-1 text-blue-600" />
                  Chaltu Girma
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runSimulation(["EIPC-EMP-004", "UNKNOWN_VISITOR"], "Staff + Unknown Visitor")}
                  isLoading={isProcessing}
                  className="text-[11px] h-8 justify-center bg-white"
                >
                  <UserX className="h-3 w-3 mr-1 text-rose-600" />
                  Staff + Visitor
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runSimulation(["EIPC-EMP-001", "EIPC-EMP-002", "EIPC-EMP-003"], "3 Staff Crowd")}
                  isLoading={isProcessing}
                  className="text-[11px] h-8 justify-center bg-white"
                >
                  <Layers className="h-3 w-3 mr-1 text-indigo-600" />
                  3-Person Crowd
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Gate Telemetry & Real-Time Passage Ticker (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Gate KPI Statistics */}
          <div className="grid grid-cols-3 gap-2.5">
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Today Passages</p>
                <p className="text-xl font-bold text-slate-800 mt-0.5">
                  {gateStatus?.today_total_passages ?? 0}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-emerald-50/60 border-emerald-100">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Entries (In)</p>
                <p className="text-xl font-bold text-emerald-800 mt-0.5">
                  {gateStatus?.today_checkins ?? 0}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-blue-50/60 border-blue-100">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider">Exits (Out)</p>
                <p className="text-xl font-bold text-blue-800 mt-0.5">
                  {gateStatus?.today_checkouts ?? 0}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Currently Detected Faces Card */}
          <Card className="shadow-sm">
            <CardHeader className="py-2.5 px-4 bg-slate-50 border-b border-slate-100 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-bold flex items-center gap-1.5 text-slate-800">
                <Activity className="h-3.5 w-3.5 text-emerald-600" />
                Active Frame Detections
              </CardTitle>
              <Badge variant={detectedFaces.length > 0 ? "success" : "brand"} className="text-[10px] font-mono">
                {detectedFaces.length} Active
              </Badge>
            </CardHeader>
            <CardContent className="p-3">
              {detectedFaces.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">
                  {isStreaming
                    ? "Scanning for faces... position face in camera view."
                    : "Camera stream offline. Start stream to begin continuous detection."}
                </div>
              ) : (
                <div className="space-y-2">
                  {detectedFaces.map((face) => (
                    <div
                      key={face.track_id}
                      className="p-2.5 rounded-lg border border-slate-200 bg-white flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900">
                            {face.employee ? face.employee.full_name : "Unrecognized Visitor"}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            {face.employee ? `(${face.employee.employee_number})` : ""}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2">
                          <span>Match Score: {Math.round(face.recognition_score * 100)}%</span>
                          <span>•</span>
                          <span>Liveness: {face.liveness_passed ? "PASSED" : "FAILED"}</span>
                        </div>
                      </div>

                      <div className="text-right flex items-center gap-1.5">
                        {face.action_status === "CONFIRMED" ? (
                          <Badge variant="success" className="text-[10px]">
                            {face.attendance_action}
                          </Badge>
                        ) : face.action_status === "COOLDOWN_ACTIVE" || face.action_status === "ALREADY_PUNCHED_IN_PASSAGE" ? (
                          <Badge variant="warning" className="text-[10px]">
                            PASSAGE LOGGED
                          </Badge>
                        ) : face.action_status === "ACQUIRING_TRACK" ? (
                          <Badge variant="brand" className="text-[10px]">
                            TRACKING ({face.frames_seen || 1}/2)
                          </Badge>
                        ) : face.action_status === "ALREADY_CHECKED_IN" ? (
                          <Badge variant="brand" className="text-[10px]">
                            CHECKED IN
                          </Badge>
                        ) : face.action_status === "NO_OPEN_SESSION" ? (
                          <Badge variant="warning" className="text-[10px]">
                            NO OPEN SESSION
                          </Badge>
                        ) : face.action_status === "SPOOF_BLOCKED" ? (
                          <Badge variant="danger" className="text-[10px]">
                            SPOOF BLOCKED
                          </Badge>
                        ) : face.action_status === "CONSENT_BLOCKED" || face.status === "CONSENT_NOT_VERIFIED" ? (
                          <Badge variant="danger" className="text-[10px]">
                            CONSENT BLOCKED
                          </Badge>
                        ) : face.matched ? (
                          <Badge variant="success" className="text-[10px]">
                            VERIFIED
                          </Badge>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Badge variant="danger" className="text-[10px]">
                              UNKNOWN
                            </Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleOpenQuickEnroll}
                              className="text-[10px] h-6 px-1.5 py-0 border-rose-300 text-rose-700 hover:bg-rose-50"
                              title="Enroll this face to an employee profile"
                            >
                              Enroll Face
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Live Gate Passage Stream Ticker */}
          <Card className="shadow-sm">
            <CardHeader className="py-2.5 px-4 bg-slate-50 border-b border-slate-100 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-bold flex items-center gap-1.5 text-slate-800">
                <Clock className="h-3.5 w-3.5 text-blue-600" />
                Live Gate Passage Stream (Last 25)
              </CardTitle>
              <Badge variant="brand" className="text-[10px]">Audit Stream</Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
                {recentPassages.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-xs">
                    No gate passage records recorded today yet.
                  </div>
                ) : (
                  recentPassages.map((p, idx) => (
                    <div key={idx} className="p-2.5 px-3 hover:bg-slate-50/70 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-[10px] shrink-0 border border-slate-200">
                          {p.employee_name
                            .split(" ")
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join("")}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900">{p.employee_name}</p>
                          <p className="text-[10px] font-mono text-slate-500">
                            {p.employee_number} • {p.department || "Staff"}
                          </p>
                        </div>
                      </div>

                      <div className="text-right space-y-0.5">
                        <div className="flex items-center gap-1 justify-end">
                          <Badge
                            variant={p.event_type === "CHECK_IN" ? "success" : "brand"}
                            className="text-[10px]"
                          >
                            {p.event_type}
                          </Badge>
                          {p.is_late && (
                            <Badge variant="danger" className="text-[9px]">
                              LATE
                            </Badge>
                          )}
                        </div>
                        <p className="text-[10px] font-mono text-slate-400">{p.timestamp_eat}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
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
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Link the live webcam photo to an employee profile. The continuous gate will immediately recognize you upon passage.
            </p>

            {enrollSnapshotB64 && (
              <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-900">
                <img
                  src={enrollSnapshotB64}
                  alt="Captured face snapshot"
                  className={`w-full h-full object-cover ${isMirrored ? "-scale-x-100" : ""}`}
                />
                <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-emerald-400 font-mono">
                  Captured Webcam Snapshot
                </span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Select Employee Profile:</label>
              <select
                value={enrollTargetEmpId}
                onChange={(e) => setEnrollTargetEmpId(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-lg border border-slate-300 p-2 text-xs font-medium text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select your Employee Name &amp; ID —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.first_name} {emp.last_name} ({emp.employee_number}) — {emp.department_name}
                  </option>
                ))}
              </select>
            </div>

            {enrollError && (
              <div className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs">
                {enrollError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
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
                disabled={!enrollTargetEmpId || isSubmittingEnroll}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Save Encrypted Biometric Template
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
