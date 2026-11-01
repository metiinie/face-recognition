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
} from "@/lib/api";
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
} from "lucide-react";

export default function ContinuousEntrancePage() {
  const [stations, setStations] = useState<StationRecord[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>("ST-GATE-01");
  const [gateMode, setGateMode] = useState<"AUTO_DETECT" | "IN" | "OUT">("AUTO_DETECT");
  const [cooldownSec, setCooldownSec] = useState<number>(20);

  // Video and Stream state
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Telemetry & metrics
  const [fps, setFps] = useState<number>(0);
  const [latencyMs, setLatencyMs] = useState<number>(85);
  const [detectedFaces, setDetectedFaces] = useState<ContinuousFaceResult[]>([]);
  const [gateStatus, setGateStatus] = useState<GateStatusResponse | null>(null);
  const [recentPassages, setRecentPassages] = useState<GatePassageRecord[]>([]);

  // Simulation Feedback Banner
  const [simMessage, setSimMessage] = useState<{ type: "success" | "warning"; text: string } | null>(null);

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const frameCountRef = useRef<number>(0);
  const lastFpsTimeRef = useRef<number>(Date.now());

  // 1. Initial Data Fetch
  const fetchGateData = useCallback(async () => {
    try {
      const [stList, status] = await Promise.all([
        api.getStations(),
        api.getGateStatus(selectedStation),
      ]);
      setStations(stList);
      setGateStatus(status);
      setRecentPassages(status.recent_passages || []);
      if (status.gate_mode) {
        setGateMode(status.gate_mode as any);
      }
    } catch (err: any) {
      console.warn("Could not load gate data:", err);
    }
  }, [selectedStation]);

  useEffect(() => {
    fetchGateData();
  }, [fetchGateData]);

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
  const startCamera = async () => {
    try {
      setStreamError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsStreaming(true);
      }
    } catch (err: any) {
      setStreamError("Unable to access optical camera device: " + (err.message || err.name));
      setIsStreaming(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    setIsStreaming(false);
    clearOverlays();
  };

  // Draw Bounding Boxes on Overlay Canvas
  const drawOverlays = useCallback((faces: ContinuousFaceResult[]) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    faces.forEach((face) => {
      const { x, y, w, h } = face.bounding_box;

      // Color scheme based on status
      let strokeColor = "#10b981"; // emerald for confirmed
      let fillColor = "rgba(16, 185, 129, 0.12)";
      let tagText = "PASSAGE CONFIRMED";

      if (face.action_status === "COOLDOWN_ACTIVE") {
        strokeColor = "#f59e0b"; // amber
        fillColor = "rgba(245, 158, 11, 0.12)";
        tagText = "COOLDOWN (PASSAGE LOGGED)";
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
      ctx.strokeRect(x, y, w, h);
      ctx.fillRect(x, y, w, h);

      // Corner accent markers
      const cornerLen = 14;
      ctx.lineWidth = 4;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(x, y + cornerLen);
      ctx.lineTo(x, y);
      ctx.lineTo(x + cornerLen, y);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(x + w - cornerLen, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + cornerLen);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(x, y + h - cornerLen);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + cornerLen, y + h);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(x + w - cornerLen, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w, y + h - cornerLen);
      ctx.stroke();

      // Top Tag Badge
      const name = face.employee ? face.employee.full_name : tagText;
      const sub = face.employee
        ? `${face.employee.employee_number} • ${Math.round(face.recognition_score * 100)}% Match`
        : `Track #${face.track_id}`;

      ctx.fillStyle = strokeColor;
      ctx.fillRect(x, Math.max(0, y - 26), Math.max(130, w * 0.9), 26);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(name, x + 6, Math.max(14, y - 12));

      ctx.font = "9px monospace";
      ctx.fillText(sub, x + 6, Math.max(24, y - 2));

      // Action punch indicator at bottom of box
      if (face.attendance_action) {
        ctx.fillStyle = face.attendance_action === "CHECK_IN" ? "#047857" : "#1d4ed8";
        ctx.fillRect(x, y + h, Math.max(100, w * 0.8), 20);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px monospace";
        ctx.fillText(
          `${face.attendance_action} ${face.is_late ? "(LATE)" : "(ON TIME)"}`,
          x + 6,
          y + h + 14
        );
      }
    });
  }, []);

  const clearOverlays = () => {
    const canvas = overlayCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  // 3. Process Live Optical Frame
  const processLiveFrame = useCallback(async () => {
    if (!videoRef.current || videoRef.current.readyState < 2 || isProcessing) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    if (overlayCanvasRef.current) {
      overlayCanvasRef.current.width = canvas.width;
      overlayCanvasRef.current.height = canvas.height;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL("image/jpeg", 0.82);

    const startTime = performance.now();
    setIsProcessing(true);

    try {
      const res: ContinuousEntranceFrameResponse = await api.processContinuousEntranceFrame({
        station_code: selectedStation,
        image_base64: base64Image,
        gate_mode: gateMode,
      });

      const tookMs = Math.round(performance.now() - startTime);
      setLatencyMs(tookMs);
      setDetectedFaces(res.faces);
      drawOverlays(res.faces);

      // Play audio chime if action was confirmed
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
      if (res.summary_actions.length > 0) {
        fetchGateData();
      }
    } catch (err: any) {
      console.warn("Continuous frame processing error:", err);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedStation, gateMode, isProcessing, drawOverlays, fetchGateData]);

  // Periodic capture loop when streaming
  useEffect(() => {
    if (isStreaming) {
      streamIntervalRef.current = setInterval(processLiveFrame, 900);
    } else {
      if (streamIntervalRef.current) {
        clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = null;
      }
      clearOverlays();
      setDetectedFaces([]);
    }
    return () => {
      if (streamIntervalRef.current) {
        clearInterval(streamIntervalRef.current);
      }
    };
  }, [isStreaming, processLiveFrame]);

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
        text: `Gate mode switched to ${mode}. Directional punches will apply automatically.`,
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
        drawOverlays(res.faces);
      }

      const confirmedNames = res.faces
        .filter((f) => f.action_status === "CONFIRMED")
        .map((f) => `${f.employee?.full_name} (${f.attendance_action})`);

      if (confirmedNames.length > 0) {
        playSoundChime("success");
        setSimMessage({
          type: "success",
          text: `[${label}] Detected ${res.faces_detected} persons. Confirmed: ${confirmedNames.join(", ")}.`,
        });
      } else {
        const cooldownNames = res.faces
          .filter((f) => f.action_status === "COOLDOWN_ACTIVE")
          .map((f) => f.employee?.full_name);
        setSimMessage({
          type: "warning",
          text: `[${label}] Cooldown Active for ${cooldownNames.join(", ")} (Passage logged recently).`,
        });
      }

      fetchGateData();
    } catch (err: any) {
      setSimMessage({
        type: "warning",
        text: err.message || "Simulation failed.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Screen V2 — Continuous-Entrance Multi-Face Gate
            </h1>
            <Badge variant="brand" className="text-xs">Option B • Autonomous</Badge>
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

      {/* Simulation Feedback Alert */}
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
                className={`w-full h-full object-cover ${isStreaming ? "block" : "hidden"}`}
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
                  {/* Top-Left: Camera status & Latency */}
                  <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
                    <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] font-mono text-emerald-400 backdrop-blur-md border border-emerald-500/30">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                      LIVE STREAM • {fps} FPS
                    </span>
                    <span className="rounded-md bg-black/60 px-2 py-1 text-[11px] font-mono text-slate-300 backdrop-blur-md border border-white/10">
                      <Zap className="inline h-3 w-3 text-amber-400 mr-1" />
                      {latencyMs}ms
                    </span>
                  </div>

                  {/* Top-Right: Faces Detected Count */}
                  <div className="absolute top-3 right-3 z-20">
                    <Badge variant="brand" className="backdrop-blur-md text-xs py-1">
                      <Users className="h-3.5 w-3.5 mr-1" />
                      {detectedFaces.length} Face{detectedFaces.length === 1 ? "" : "s"} in View
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
                  <Button size="sm" variant="danger" onClick={stopCamera} className="text-xs h-7">
                    <Pause className="h-3 w-3 mr-1" /> Stop Stream
                  </Button>
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
              <Badge variant="brand" className="text-[10px] font-mono">
                {detectedFaces.length} Active
              </Badge>
            </CardHeader>
            <CardContent className="p-3">
              {detectedFaces.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">
                  No face detected in the current gate frame.
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
                          <span>Confidence: {Math.round(face.recognition_score * 100)}%</span>
                          <span>•</span>
                          <span>Liveness: {face.liveness_passed ? "PASSED" : "FAILED"}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        {face.action_status === "CONFIRMED" ? (
                          <Badge variant="success" className="text-[10px]">
                            {face.attendance_action}
                          </Badge>
                        ) : face.action_status === "COOLDOWN_ACTIVE" ? (
                          <Badge variant="warning" className="text-[10px]">
                            COOLDOWN
                          </Badge>
                        ) : (
                          <Badge variant="danger" className="text-[10px]">
                            UNKNOWN
                          </Badge>
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
    </div>
  );
}

