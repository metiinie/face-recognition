"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import {
  api,
  ContinuousFaceResult,
  ContinuousEntranceFrameResponse,
  GatePassageRecord,
  GateStatusResponse,
  StationRecord,
  EmployeeRecord,
  getStoredUser,
  UserProfile,
} from "@/lib/api";
import { getEntranceSocket } from "@/lib/socket";
import {
  Radio,
  Play,
  Pause,
  RefreshCw,
  Users,
  CheckCircle2,
  Clock,
  ShieldAlert,
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
  Sliders,
  Lock,
} from "lucide-react";

export default function ContinuousEntrancePage() {
  const [stations, setStations] = useState<StationRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>("ST-GATE-01");
  const [gateMode, setGateMode] = useState<"AUTO_DETECT" | "IN" | "OUT">("AUTO_DETECT");
  const [cooldownSec, setCooldownSec] = useState<number>(20);
  const [minCheckoutMins, setMinCheckoutMins] = useState<number>(15);
  const [minPersistenceFrames, setMinPersistenceFrames] = useState<number>(3);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Video and Stream state
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isMirrored, setIsMirrored] = useState<boolean>(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [insecureContextInfo, setInsecureContextInfo] = useState<{
    origin: string;
    protocol: string;
    host: string;
  } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isAudioSuspended, setIsAudioSuspended] = useState<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

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

  // Administrative Authorization & Transport Telemetry
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [adminUnlocked, setAdminUnlocked] = useState<boolean>(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState<string>("");
  const [tuningSaveError, setTuningSaveError] = useState<string | null>(null);
  const [isSavingTuning, setIsSavingTuning] = useState<boolean>(false);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [isTestingPing, setIsTestingPing] = useState<boolean>(false);

  useEffect(() => {
    const user = getStoredUser();
    setCurrentUser(user);
    if (user?.role === "SYSTEM_ADMIN") {
      setAdminUnlocked(true);
    }
  }, []);

  const isAdmin = currentUser?.role === "SYSTEM_ADMIN" || adminUnlocked;

  // Quick Face Enrollment Modal State
  const [showEnrollModal, setShowEnrollModal] = useState<boolean>(false);
  const [enrollTargetEmpId, setEnrollTargetEmpId] = useState<number | "">("");
  const [enrollSnapshotB64, setEnrollSnapshotB64] = useState<string | null>(null);
  const [isSubmittingEnroll, setIsSubmittingEnroll] = useState<boolean>(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [showSimTools, setShowSimTools] = useState<boolean>(false);

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isStreamingRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
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
      if (status.cooldown_sec !== undefined) {
        setCooldownSec(status.cooldown_sec);
      }
      if (status.min_checkout_elapsed_mins !== undefined) {
        setMinCheckoutMins(status.min_checkout_elapsed_mins);
      }
      if (status.min_persistence_frames !== undefined) {
        setMinPersistenceFrames(status.min_persistence_frames);
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
    };
  }, [selectedStation, fetchGateData]);

  // Audio Context Singleton & Autoplay Policy Resilience (E2)
  const getAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const unlockAudio = () => {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().then(() => {
          setIsAudioSuspended(false);
        }).catch(() => {});
      } else if (ctx && ctx.state === "running") {
        setIsAudioSuspended(false);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("click", unlockAudio, { passive: true });
      window.addEventListener("touchstart", unlockAudio, { passive: true });
      window.addEventListener("keydown", unlockAudio, { passive: true });

      return () => {
        window.removeEventListener("click", unlockAudio);
        window.removeEventListener("touchstart", unlockAudio);
        window.removeEventListener("keydown", unlockAudio);
      };
    }
  }, [getAudioContext]);

  // Audio Chime Synthesizer
  const playSoundChime = (type: "success" | "warning") => {
    if (!soundEnabled || typeof window === "undefined") return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === "suspended") {
        setIsAudioSuspended(true);
        ctx.resume().then(() => {
          setIsAudioSuspended(false);
        }).catch(() => {});
        return;
      }
      setIsAudioSuspended(false);

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
      setInsecureContextInfo(null);
      if (typeof window !== "undefined") {
        const isLocal =
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1";
        if (!window.isSecureContext && !isLocal) {
          setInsecureContextInfo({
            origin: window.location.origin,
            protocol: window.location.protocol,
            host: window.location.host,
          });
          throw new Error("INSECURE_CONTEXT");
        }
      }
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
      if (err.message === "INSECURE_CONTEXT") {
        setStreamError("Insecure HTTP context detected. Browser requires HTTPS for optical camera access on LAN.");
      } else {
        setStreamError(
          err.name === "NotAllowedError"
            ? "Camera permission denied. Please allow optical camera access in your browser settings."
            : "Unable to access optical camera device: " + (err.message || err.name)
        );
      }
      isStreamingRef.current = false;
      setIsStreaming(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    isMountedRef.current = false;
    isStreamingRef.current = false;
    setIsStreaming(false);
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
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
    isMountedRef.current = true;
    startCamera();
    return () => {
      isMountedRef.current = false;
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

      // Color scheme based on status:
      // Neutral default for NONE / unknown / unconfirmed faces (never default to green or confirmed)
      let strokeColor = "#64748b"; // Neutral slate-500
      let fillColor = "rgba(100, 116, 139, 0.10)";
      let tagText = "DETECTING...";

      const actionStatus = face.action_status || "NONE";

      if (actionStatus === "CONFIRMED") {
        // Green — Passage confirmed
        strokeColor = "#10b981"; // emerald-500
        fillColor = "rgba(16, 185, 129, 0.16)";
        tagText = face.attendance_action === "CHECK_OUT" ? "CHECK-OUT CONFIRMED" : "PASSAGE CONFIRMED";
      } else if (actionStatus === "REJECTED") {
        // Red — Recognition rejected
        strokeColor = "#ef4444"; // red-500
        fillColor = "rgba(239, 68, 68, 0.20)";
        tagText = "RECOGNITION REJECTED";
      } else if (actionStatus === "INACTIVE_BLOCKED") {
        // Red — Employee inactive
        strokeColor = "#dc2626"; // red-600
        fillColor = "rgba(220, 38, 38, 0.20)";
        tagText = "EMPLOYEE INACTIVE";
      } else if (actionStatus === "SPOOF_BLOCKED") {
        // Red — Presentation attack / spoof detected
        strokeColor = "#dc2626"; // red-600
        fillColor = "rgba(220, 38, 38, 0.22)";
        tagText = "SPOOF ATTACK BLOCKED";
      } else if (actionStatus === "CONSENT_BLOCKED" || face.status === "CONSENT_NOT_VERIFIED") {
        // Red — Biometric consent unverified / revoked
        strokeColor = "#dc2626"; // red-600
        fillColor = "rgba(220, 38, 38, 0.22)";
        tagText = "CONSENT NOT VERIFIED";
      } else if (actionStatus === "COOLDOWN_ACTIVE") {
        // Amber — Please wait (Cooldown active)
        strokeColor = "#f59e0b"; // amber-500
        fillColor = "rgba(245, 158, 11, 0.15)";
        tagText = "PLEASE WAIT (COOLDOWN)";
      } else if (actionStatus === "ACQUIRING_TRACK") {
        // Blue — Tracking
        strokeColor = "#0284c7"; // sky-600
        fillColor = "rgba(2, 132, 199, 0.15)";
        const targetFrames = gateStatus?.min_persistence_frames || 3;
        tagText = `TRACKING (${face.frames_seen || 1}/${targetFrames} FRAMES)`;
      } else if (actionStatus === "ALREADY_PUNCHED_IN_PASSAGE") {
        strokeColor = "#059669"; // teal/emerald-600
        fillColor = "rgba(5, 150, 105, 0.14)";
        tagText = "PASSAGE ALREADY RECORDED";
      } else if (actionStatus === "ALREADY_CHECKED_IN") {
        strokeColor = "#0891b2"; // cyan-600
        fillColor = "rgba(8, 145, 178, 0.14)";
        tagText = "ALREADY CHECKED IN";
      } else if (actionStatus === "NO_OPEN_SESSION") {
        strokeColor = "#db2777"; // pink-600
        fillColor = "rgba(219, 39, 119, 0.14)";
        tagText = "NO OPEN SESSION (CANNOT EXIT)";
      } else if (actionStatus === "STATIONARY_LINGER") {
        strokeColor = "#7c3aed"; // violet-600
        fillColor = "rgba(124, 58, 237, 0.14)";
        tagText = "STEP FORWARD TO REGISTER";
      } else if (actionStatus === "UNKNOWN_VISITOR" || face.status === "UNKNOWN_FACE") {
        strokeColor = "#f43f5e"; // rose-500
        fillColor = "rgba(244, 63, 94, 0.16)";
        tagText = "UNKNOWN VISITOR";
      } else if (
        actionStatus === "UNCERTAIN_TRACK" ||
        actionStatus === "UNCERTAIN_CANDIDATE" ||
        face.status === "UNCERTAIN_MATCH"
      ) {
        strokeColor = "#eab308"; // yellow-500
        fillColor = "rgba(234, 179, 8, 0.15)";
        tagText = "IDENTITY UNCERTAIN (STEP CLOSER)";
      } else {
        // Neutral — Detecting (NONE, uncommitted, or unknown)
        strokeColor = "#64748b";
        fillColor = "rgba(100, 116, 139, 0.10)";
        tagText = "DETECTING...";
      }

      // Crisp unobstructed corner-bracket box (Image 3 style)
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = strokeColor;
      ctx.globalAlpha = 0.38;
      ctx.strokeRect(drawX, y, w, h);
      ctx.globalAlpha = 1;

      ctx.fillStyle = fillColor;
      ctx.fillRect(drawX, y, w, h);

      // Sharp L-shaped corner markers
      const cornerLen = Math.min(18, Math.max(10, Math.round(w * 0.16)));
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = strokeColor;
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
      let name = tagText;
      let sub = `Track #${face.track_id} • ${face.motion_direction || "ACQUIRING"}`;

      if (face.employee) {
        if (actionStatus === "CONFIRMED") {
          name = `${face.employee.full_name} • ${face.attendance_action === "CHECK_OUT" ? "OUT" : "IN"}`;
          sub = `${face.employee.employee_number} • ${Math.round(face.recognition_score * 100)}% • ${face.motion_direction || "APPROACHING"}`;
        } else if (actionStatus === "INACTIVE_BLOCKED") {
          name = `${face.employee.full_name} (INACTIVE)`;
          sub = `ACCESS BLOCKED • ${face.employee.employee_number}`;
        } else if (actionStatus === "REJECTED") {
          name = `${face.employee.full_name} (REJECTED)`;
          sub = `RECOGNITION REJECTED • ${face.employee.employee_number}`;
        } else if (actionStatus === "COOLDOWN_ACTIVE") {
          name = `${face.employee.full_name} (COOLDOWN)`;
          sub = `PLEASE WAIT • ${face.employee.employee_number}`;
        } else if (actionStatus === "ACQUIRING_TRACK") {
          name = `${face.employee.full_name} (TRACKING)`;
          sub = `Acquiring ${face.frames_seen || 1}/${gateStatus?.min_persistence_frames || 3} • ${face.employee.employee_number}`;
        } else {
          name = face.employee.full_name;
          sub = `${face.employee.employee_number} • ${Math.round(face.recognition_score * 100)}% • ${tagText}`;
        }
      }

      const tagWidth = Math.max(150, w);
      const tagY = Math.max(0, y - 30);
      ctx.fillStyle = "rgba(11, 15, 23, 0.88)";
      ctx.fillRect(drawX, tagY, tagWidth, 28);
      ctx.fillStyle = strokeColor;
      ctx.fillRect(drawX, tagY, 3, 28);

      ctx.fillStyle = "#f8fafc";
      ctx.font = "600 11px Inter, sans-serif";
      ctx.fillText(name, drawX + 8, tagY + 13);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "500 9px monospace";
      ctx.fillText(sub, drawX + 8, tagY + 24);

      if (actionStatus === "CONFIRMED" && face.attendance_action) {
        ctx.fillStyle = face.attendance_action === "CHECK_IN" ? "rgba(5, 150, 105, 0.92)" : "rgba(79, 70, 229, 0.92)";
        ctx.fillRect(drawX, y + h + 2, Math.max(120, w * 0.85), 18);
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 9.5px monospace";
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
    if (!isMountedRef.current || !videoRef.current || videoRef.current.readyState < 2 || isProcessingRef.current || !isStreamingRef.current) {
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

      if (!isMountedRef.current || !isStreamingRef.current) return;
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
      if (!isMountedRef.current) return;
      console.warn("Continuous frame processing error:", err);
      setStreamError(err.message || "Frame recognition request failed.");
    } finally {
      if (isMountedRef.current) {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
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
      isStreamingRef.current = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [isStreaming, isWsConnected, processLiveFrame]);

  // 4. Transport Health & Ping Test
  const handleReconnectTransport = useCallback(async () => {
    setIsTestingPing(true);
    const start = performance.now();
    try {
      const socket = getEntranceSocket();
      if (!socket.connected) {
        socket.connect();
      }
      await api.getGateConfig(selectedStation);
      const elapsed = Math.round(performance.now() - start);
      setRttMs(elapsed);
      if (socket.connected) {
        setTransportMode("WEBSOCKET");
        setIsWsConnected(true);
      } else {
        setTransportMode("HTTP_FALLBACK");
      }
    } catch {
      setRttMs(Math.round(performance.now() - start));
    } finally {
      setIsTestingPing(false);
    }
  }, [selectedStation]);

  // 5. Change Gate Direction (Unrestricted Operator Control)
  const handleModeChange = async (mode: "AUTO_DETECT" | "IN" | "OUT") => {
    setGateMode(mode);
    try {
      // Operators have unrestricted authority over gate direction
      await api.configureGate({
        station_code: selectedStation,
        gate_mode: mode,
      });
      setSimMessage({
        type: "success",
        text: mode === "AUTO_DETECT"
          ? `Gate direction set to Auto-Detect bidirectional with accidental checkout protection (${minCheckoutMins}m debounce, ${minPersistenceFrames} frame persistence).`
          : `Gate direction switched to ${mode}. Directional punches apply automatically.`,
      });
    } catch (err: any) {
      console.error("Failed to update gate direction:", err);
      setSimMessage({
        type: "warning",
        text: `Failed to update gate direction: ${err.message}`,
      });
    }
  };

  // 6. Save Gate Tuning Parameters (Restricted to Administrators)
  const handleSaveGateSettings = async () => {
    setIsSavingTuning(true);
    setTuningSaveError(null);
    try {
      const payload: any = {
        station_code: selectedStation,
        gate_mode: gateMode,
        cooldown_sec: cooldownSec,
        min_checkout_elapsed_mins: minCheckoutMins,
        min_persistence_frames: minPersistenceFrames,
      };

      if (!isAdmin && adminPasswordInput.trim()) {
        payload.admin_password = adminPasswordInput.trim();
      }

      const res = await api.configureGate(payload);
      if (res.is_admin || adminPasswordInput.trim()) {
        setAdminUnlocked(true);
      }
      setIsSettingsOpen(false);
      setSimMessage({
        type: "success",
        text: `Gate tuning updated: Cooldown ${cooldownSec}s, Checkout debounce ${minCheckoutMins}m, Persistence ${minPersistenceFrames} frames.`,
      });
      fetchGateData();
    } catch (err: any) {
      setTuningSaveError(err.message || "Failed to save gate tuning parameters.");
      setSimMessage({
        type: "warning",
        text: `Failed to save gate tuning parameters: ${err.message}`,
      });
    } finally {
      setIsSavingTuning(false);
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

      if (!isMountedRef.current || !isStreamingRef.current) return;
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

  const rejectedCount = detectedFaces.filter(
    (f) => f.action_status === "REJECTED" || f.action_status === "SPOOF_BLOCKED"
  ).length;

  return (
    <div className="space-y-4 text-slate-100">
      <canvas ref={canvasRef} className="hidden" />

      {/* Dark Obsidian Operator Control Strip */}
      <div className="rounded-xl border border-[#1E293B] bg-[#121826] px-4 py-3 space-y-2.5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight text-white">
                  Gate Monitor
                </h1>
                {transportMode === "WEBSOCKET" && isWsConnected ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400 tabular-nums">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span>WS Live{rttMs !== null ? ` · ${rttMs}ms` : ""}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300 tabular-nums">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    <span>HTTP Poll{rttMs !== null ? ` · ${rttMs}ms` : ""}</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Multi-person optical entrance tracking and autonomous check-in/out stream.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Station Selector */}
            <div className="flex items-center gap-1.5 rounded-lg border border-[#1E293B] bg-[#0B0F17] px-2.5 h-8 text-xs">
              <Building2 className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
              <select
                value={selectedStation}
                onChange={(e) => setSelectedStation(e.target.value)}
                aria-label="Gate Station"
                className="font-medium text-slate-200 bg-transparent focus:outline-none"
              >
                {stations.length > 0 ? (
                  stations.map((s) => (
                    <option key={s.id} value={s.station_code} className="bg-[#121826] text-slate-100">
                      {s.station_code} — {s.name}
                    </option>
                  ))
                ) : (
                  <option value="ST-GATE-01" className="bg-[#121826] text-slate-100">
                    ST-GATE-01 — Main Campus Gate
                  </option>
                )}
              </select>
            </div>

            {/* Direction Mode Segmented Control */}
            <div className="inline-flex h-8 items-center rounded-lg border border-[#1E293B] bg-[#0B0F17] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => handleModeChange("IN")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  gateMode === "IN"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Entry
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("AUTO_DETECT")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  gateMode === "AUTO_DETECT"
                    ? "bg-[#4F46E5] text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Auto
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("OUT")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  gateMode === "OUT"
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Exit
              </button>
            </div>

            {soundEnabled && isAudioSuspended && (
              <button
                type="button"
                onClick={() => {
                  const ctx = getAudioContext();
                  ctx?.resume().then(() => setIsAudioSuspended(false)).catch(() => {});
                }}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/15 px-2.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition-colors"
              >
                <VolumeX className="h-3.5 w-3.5" />
                <span>Unlock Audio</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (next) {
                  const ctx = getAudioContext();
                  ctx?.resume().then(() => setIsAudioSuspended(false)).catch(() => {});
                }
              }}
              title={soundEnabled ? "Mute Gate Chime" : "Enable Gate Chime"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:bg-slate-800 transition-colors"
            >
              {soundEnabled ? (
                <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <VolumeX className="h-3.5 w-3.5 text-slate-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#1E293B] bg-[#0B0F17] px-2.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
              title="Configure Gate Timing & Persistence"
            >
              <Sliders className="h-3.5 w-3.5 text-slate-400" />
              <span className="hidden sm:inline">Tuning</span>
              {!isAdmin && <Lock className="h-3 w-3 text-amber-400" />}
            </button>

            <button
              type="button"
              onClick={() => {
                fetchGateData();
                handleReconnectTransport();
              }}
              disabled={isTestingPing}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#1E293B] bg-[#0B0F17] text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
              title="Refresh data & reconnect stream"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isTestingPing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Quiet Timing Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1E293B] pt-2 text-[11px] text-slate-400">
          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 hover:text-slate-200 transition-colors"
            >
              <Clock className="h-3 w-3 text-amber-400" />
              <span>Checkout Debounce: <strong className="text-slate-200">{minCheckoutMins}m</strong></span>
            </button>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 hover:text-slate-200 transition-colors"
            >
              <Layers className="h-3 w-3 text-indigo-400" />
              <span>Persistence: <strong className="text-slate-200">{minPersistenceFrames}f</strong></span>
            </button>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 hover:text-slate-200 transition-colors"
            >
              <ShieldAlert className="h-3 w-3 text-slate-400" />
              <span>Cooldown: <strong className="text-slate-200">{cooldownSec}s</strong></span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowSimTools(!showSimTools)}
            className="text-slate-400 hover:text-white font-medium transition-colors"
          >
            {showSimTools ? "Hide simulation" : "Simulation tools"}
          </button>
        </div>
      </div>

      {simMessage && (
        <div
          className={`px-3.5 py-2.5 rounded-lg border text-xs flex items-center justify-between ${
            simMessage.type === "success"
              ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
              : "bg-amber-500/10 text-amber-300 border-amber-500/30"
          }`}
        >
          <div className="flex items-center gap-2">
            {simMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            )}
            <span>{simMessage.text}</span>
          </div>
          <button onClick={() => setSimMessage(null)} className="text-xs underline hover:opacity-80">
            Dismiss
          </button>
        </div>
      )}

      {streamError && !insecureContextInfo && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" />
          <span>{streamError}</span>
        </div>
      )}

      {/* Main Dark Monitor Grid: 8 Col Surveillance Feed + 4 Col Live Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left: Optical Stream + 4-Stat Telemetry Bar */}
        <div className="lg:col-span-8 space-y-3">
          <div className="rounded-xl border border-[#1E293B] bg-[#06090F] overflow-hidden relative">
            <div className="relative aspect-[16/10] sm:aspect-[4/3] w-full bg-[#06090F] flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover transition-transform duration-150 ${
                  isMirrored ? "-scale-x-100" : ""
                } ${isStreaming ? "block" : "opacity-0 pointer-events-none absolute inset-0"}`}
              />

              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none z-10"
              />

              {insecureContextInfo ? (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0B0F17]/95 p-6 text-center text-white backdrop-blur-sm">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 mb-3 border border-rose-500/30">
                    <ShieldAlert className="h-6 w-6" />
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1">
                    Camera Sensor Blocked: Insecure HTTP Context
                  </h4>
                  <p className="text-xs text-slate-400 max-w-md mb-4 leading-relaxed">
                    Browser security policies restrict optical sensors over plain HTTP on LAN IPs. Connect via institutional HTTPS for gate monitoring.
                  </p>
                  <div className="w-full max-w-sm rounded-lg border border-[#1E293B] bg-[#121826] p-3 text-left font-mono text-[11px] space-y-1 mb-4 text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Origin:</span>
                      <span className="text-rose-400 truncate max-w-[200px]" title={insecureContextInfo.origin}>
                        {insecureContextInfo.origin}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Recommended:</span>
                      <span className="text-emerald-400">https://{insecureContextInfo.host.split(":")[0]} (443)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => {
                        if (typeof window !== "undefined") {
                          window.location.href = window.location.href.replace("http:", "https:");
                        }
                      }}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span>Switch to HTTPS</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={startCamera}
                      className="border-[#1E293B] bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Retry</span>
                    </Button>
                  </div>
                </div>
              ) : !isStreaming ? (
                <div className="text-center p-6 space-y-3 z-0">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#121826] text-indigo-400 border border-[#1E293B]">
                    <Radio className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">
                      Gate Monitor Standby
                    </h3>
                    <p className="text-xs text-slate-500 max-w-sm mt-1">
                      Start the live optical stream or use simulation controls to test multi-face tracking.
                    </p>
                  </div>
                  <Button onClick={startCamera} size="sm" variant="primary">
                    <Play className="h-3.5 w-3.5" />
                    <span>Start Optical Stream</span>
                  </Button>
                </div>
              ) : null}

              {isStreaming && (
                <>
                  {/* Top-Left Stream Readout */}
                  <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-1.5">
                    <span className="flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-[11px] font-mono text-emerald-400 backdrop-blur-sm border border-white/10 tabular-nums">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <span>LIVE · {fps} FPS</span>
                    </span>
                    <span className="rounded-md bg-black/65 px-2 py-1 text-[11px] font-mono text-slate-300 backdrop-blur-sm border border-white/10 tabular-nums">
                      {latencyMs}ms
                    </span>
                  </div>

                  {/* Top-Right Active Faces Pill */}
                  <div className="absolute top-3 right-3 z-20">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm border tabular-nums ${
                        detectedFaces.length > 0
                          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                          : "bg-black/65 border-white/10 text-slate-300"
                      }`}
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span>
                        {detectedFaces.length} Tracked
                      </span>
                    </span>
                  </div>

                  {/* Bottom HUD Control Strip */}
                  <div className="absolute bottom-3 inset-x-3 z-20 flex flex-wrap items-center justify-between gap-2 bg-[#0B0F17]/85 px-3 py-2 rounded-lg backdrop-blur-md border border-white/10">
                    <div className="flex items-center gap-2 text-[11px] text-slate-300 font-mono">
                      <span className="text-indigo-400 font-medium">{selectedStation}</span>
                      <span className="text-slate-600">|</span>
                      <span className="text-emerald-400">{gateMode}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setIsMirrored(!isMirrored)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 text-[11px] font-medium text-slate-200 hover:bg-white/15 transition-colors"
                      >
                        <FlipHorizontal className="h-3 w-3 text-slate-300" />
                        <span>{isMirrored ? "Mirrored" : "Direct"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenQuickEnroll}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 text-[11px] font-medium text-slate-200 hover:bg-white/15 transition-colors"
                      >
                        <UserPlus className="h-3 w-3 text-indigo-400" />
                        <span>Enroll</span>
                      </button>
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-rose-600 hover:bg-rose-700 px-2.5 text-[11px] font-medium text-white transition-colors"
                      >
                        <Pause className="h-3 w-3" />
                        <span>Stop</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Bottom 4-Stat Telemetry Bar (Image 2 Gate) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-[#1E293B] bg-[#121826] p-3.5">
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-slate-400">
                Total Scans
              </p>
              <p className="mt-1 text-xl font-semibold text-white tabular-nums">
                {gateStatus?.today_total_passages ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-[#1E293B] bg-[#121826] p-3.5">
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-emerald-400">
                Entries
              </p>
              <p className="mt-1 text-xl font-semibold text-emerald-400 tabular-nums">
                {gateStatus?.today_checkins ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-[#1E293B] bg-[#121826] p-3.5">
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-indigo-400">
                Exits
              </p>
              <p className="mt-1 text-xl font-semibold text-indigo-400 tabular-nums">
                {gateStatus?.today_checkouts ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-[#1E293B] bg-[#121826] p-3.5">
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-rose-400">
                Rejected Frame
              </p>
              <p className="mt-1 text-xl font-semibold text-rose-400 tabular-nums">
                {rejectedCount}
              </p>
            </div>
          </div>

          {/* Collapsible Dark Simulation Sandbox */}
          {showSimTools && (
            <div className="rounded-xl border border-[#1E293B] bg-[#121826] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#1E293B] flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-white">Crowd Simulation Sandbox</h3>
                  <p className="text-[11px] text-slate-400">
                    Test multi-face detection, persistence, and debounce without optical hardware.
                  </p>
                </div>
                <span className="rounded border border-[#1E293B] bg-[#0B0F17] px-2 py-0.5 text-[10px] font-mono text-slate-400">
                  MOCK
                </span>
              </div>
              <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => runSimulation(["EIPC-EMP-001", "EIPC-EMP-002"], "2 Staff Entering Together")}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#1E293B] bg-[#0B0F17] px-2.5 text-[11px] font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  <Users className="h-3 w-3 text-emerald-400" />
                  <span>Abebe + Hanna</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => runSimulation(["EIPC-EMP-003"], "Solo Staff Fast Passage")}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#1E293B] bg-[#0B0F17] px-2.5 text-[11px] font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  <UserCheck className="h-3 w-3 text-indigo-400" />
                  <span>Chaltu Girma</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => runSimulation(["EIPC-EMP-004", "UNKNOWN_VISITOR"], "Staff + Unknown Visitor")}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#1E293B] bg-[#0B0F17] px-2.5 text-[11px] font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  <UserX className="h-3 w-3 text-rose-400" />
                  <span>Staff + Visitor</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => runSimulation(["EIPC-EMP-001", "EIPC-EMP-002", "EIPC-EMP-003"], "3 Staff Crowd")}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#1E293B] bg-[#0B0F17] px-2.5 text-[11px] font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  <Layers className="h-3 w-3 text-amber-400" />
                  <span>3-Person Crowd</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Active Detections + Last 25 Passages */}
        <div className="lg:col-span-4 space-y-4">
          {/* Active Frame Detections */}
          <div className="rounded-xl border border-[#1E293B] bg-[#121826] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1E293B] flex items-center justify-between">
              <h2 className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-emerald-400" />
                <span>Active Frame Detections</span>
              </h2>
              <span className="rounded-md border border-[#1E293B] bg-[#0B0F17] px-2 py-0.5 text-[10px] font-mono text-slate-300 tabular-nums">
                {detectedFaces.length} Active
              </span>
            </div>
            <div className="p-3">
              {detectedFaces.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">
                  {isStreaming
                    ? "Monitoring camera view for incoming faces..."
                    : "Stream offline. Start stream to inspect active detections."}
                </div>
              ) : (
                <div className="space-y-2">
                  {detectedFaces.map((face) => (
                    <div
                      key={face.track_id}
                      className="p-2.5 rounded-lg border border-[#1E293B] bg-[#0B0F17] flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-100 truncate">
                            {face.employee ? face.employee.full_name : "Unrecognized Visitor"}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                          {Math.round(face.recognition_score * 100)}% ·{" "}
                          <span className={face.liveness_passed ? "text-emerald-400" : "text-rose-400"}>
                            {face.liveness_passed ? "LIVE" : "SPOOF"}
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5">
                        {face.action_status === "CONFIRMED" ? (
                          <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            {face.attendance_action}
                          </span>
                        ) : face.action_status === "REJECTED" ||
                          face.action_status === "INACTIVE_BLOCKED" ||
                          face.action_status === "SPOOF_BLOCKED" ||
                          face.action_status === "CONSENT_BLOCKED" ||
                          face.status === "CONSENT_NOT_VERIFIED" ? (
                          <span className="rounded bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                            {face.action_status?.replace(/_/g, " ") || "BLOCKED"}
                          </span>
                        ) : face.action_status === "COOLDOWN_ACTIVE" ||
                          face.action_status === "ALREADY_PUNCHED_IN_PASSAGE" ||
                          face.action_status === "UNCERTAIN_TRACK" ||
                          face.action_status === "NO_OPEN_SESSION" ? (
                          <span className="rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                            {face.action_status === "NO_OPEN_SESSION" ? "NO SESSION" : "WAIT"}
                          </span>
                        ) : face.action_status === "ACQUIRING_TRACK" ? (
                          <span className="rounded bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-medium text-indigo-300 tabular-nums">
                            {face.frames_seen || 1}/{gateStatus?.min_persistence_frames || 3}f
                          </span>
                        ) : face.action_status === "ALREADY_CHECKED_IN" ||
                          (face.matched && face.action_status !== "NONE") ? (
                          <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            VERIFIED
                          </span>
                        ) : face.action_status === "NONE" ? (
                          <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                            DETECTING
                          </span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="rounded bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                              UNKNOWN
                            </span>
                            <button
                              type="button"
                              onClick={handleOpenQuickEnroll}
                              className="rounded border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-300 hover:bg-indigo-500/25"
                            >
                              Enroll
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Last 25 Passages Ticker */}
          <div className="rounded-xl border border-[#1E293B] bg-[#121826] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1E293B] flex items-center justify-between">
              <h2 className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-indigo-400" />
                <span>Recent Passages (Last 25)</span>
              </h2>
              <span className="text-[10px] font-mono text-slate-400">LIVE FEED</span>
            </div>
            <div className="dark-scroll divide-y divide-[#1E293B] max-h-[400px] overflow-y-auto">
              {recentPassages.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  No gate passages recorded yet today.
                </div>
              ) : (
                recentPassages.map((p, idx) => (
                  <div
                    key={idx}
                    className="px-3.5 py-2.5 hover:bg-white/[0.02] flex items-center justify-between gap-2 text-xs transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-7 w-7 rounded-full bg-[#0B0F17] text-slate-200 font-semibold flex items-center justify-center text-[10px] shrink-0 border border-[#1E293B]">
                        {p.employee_name
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-100 truncate">{p.employee_name}</p>
                        <p className="text-[10.5px] font-mono text-slate-400 truncate">
                          {p.employee_number} · {p.department || "Staff"}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-0.5">
                      <div className="flex items-center gap-1 justify-end">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9.5px] font-medium ${
                            p.event_type === "CHECK_IN"
                              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
                              : "bg-indigo-500/15 text-indigo-300 border border-indigo-500/25"
                          }`}
                        >
                          {p.event_type === "CHECK_IN" ? "IN" : "OUT"}
                        </span>
                        {p.is_late && (
                          <span className="rounded bg-amber-500/15 text-amber-300 border border-amber-500/25 px-1.5 py-0.5 text-[9.5px] font-medium">
                            LATE
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-slate-500 tabular-nums">
                        {p.timestamp_eat}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dark Quick Face Enrollment Modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-xl border border-[#1E293B] bg-[#121826] p-5 shadow-2xl space-y-4 text-slate-100">
            <div className="flex items-center justify-between border-b border-[#1E293B] pb-3">
              <div>
                <h3 className="font-semibold text-white text-sm">Quick Gate Face Enrollment</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Link captured snapshot to enable continuous gate recognition.
                </p>
              </div>
              <button
                onClick={() => setShowEnrollModal(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {enrollSnapshotB64 && (
              <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden border border-[#1E293B] bg-[#06090F]">
                <img
                  src={enrollSnapshotB64}
                  alt="Captured face snapshot"
                  className={`w-full h-full object-cover ${isMirrored ? "-scale-x-100" : ""}`}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Employee Profile</label>
              <select
                value={enrollTargetEmpId}
                onChange={(e) => setEnrollTargetEmpId(e.target.value ? Number(e.target.value) : "")}
                className="h-9 w-full rounded-lg border border-[#1E293B] bg-[#0B0F17] px-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">— Select Employee Name &amp; ID —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.first_name} {emp.last_name} ({emp.employee_number}) — {emp.department_name}
                  </option>
                ))}
              </select>
            </div>

            {enrollError && (
              <div className="p-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs">
                {enrollError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1E293B]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEnrollModal(false)}
                disabled={isSubmittingEnroll}
                className="border-[#1E293B] bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmEnrollment}
                isLoading={isSubmittingEnroll}
                disabled={!enrollTargetEmpId || isSubmittingEnroll}
              >
                Save Biometric Template
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Dark Gate Tuning Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg rounded-xl border border-[#1E293B] bg-[#121826] p-5 shadow-2xl space-y-4 text-slate-100">
            <div className="flex items-center justify-between border-b border-[#1E293B] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Continuous Gate Tuning</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Timing debounce and persistence frame parameters.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin ? (
                  <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                    Admin Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                    <Lock className="h-2.5 w-2.5" />
                    Admin Locked
                  </span>
                )}
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {!isAdmin && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 p-3 text-xs text-amber-200 space-y-1">
                <div className="font-medium flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span>Administrator Step-Up Required</span>
                </div>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  Direction controls can be toggled freely, while cooldown and tracking persistence changes require System Administrator authorization.
                </p>
              </div>
            )}

            {tuningSaveError && (
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-2.5 text-xs text-rose-300 flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                <span>{tuningSaveError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-slate-300">
                    Passage Cooldown (Seconds)
                  </label>
                  <span className="font-mono text-indigo-300 font-medium tabular-nums">
                    {cooldownSec}s
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  disabled={!isAdmin}
                  value={cooldownSec}
                  onChange={(e) => setCooldownSec(Number(e.target.value))}
                  className="w-full accent-[#4F46E5] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-slate-300">
                    Accidental Checkout Debounce (Minutes)
                  </label>
                  <span className="font-mono text-indigo-300 font-medium tabular-nums">
                    {minCheckoutMins}m
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={60}
                  step={1}
                  disabled={!isAdmin}
                  value={minCheckoutMins}
                  onChange={(e) => setMinCheckoutMins(Number(e.target.value))}
                  className="w-full accent-[#4F46E5] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-slate-300">
                    Minimum Tracking Persistence (Frames)
                  </label>
                  <span className="font-mono text-indigo-300 font-medium tabular-nums">
                    {minPersistenceFrames} frames
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  disabled={!isAdmin}
                  value={minPersistenceFrames}
                  onChange={(e) => setMinPersistenceFrames(Number(e.target.value))}
                  className="w-full accent-[#4F46E5] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>

              {!isAdmin && (
                <div className="rounded-lg border border-[#1E293B] bg-[#0B0F17] p-3 space-y-1.5">
                  <label className="text-[11px] font-medium text-slate-300 block">
                    Admin Step-Up Password
                  </label>
                  <input
                    type="password"
                    value={adminPasswordInput}
                    onChange={(e) => setAdminPasswordInput(e.target.value)}
                    placeholder="Enter administrator password"
                    className="h-8 w-full rounded-lg border border-[#1E293B] bg-[#121826] px-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#1E293B]">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsSettingsOpen(false)}
                disabled={isSavingTuning}
                className="border-[#1E293B] bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSaveGateSettings}
                disabled={isSavingTuning || (!isAdmin && !adminPasswordInput.trim())}
                isLoading={isSavingTuning}
              >
                {isAdmin
                  ? "Save Tuning"
                  : adminPasswordInput.trim()
                  ? "Authorize & Save"
                  : "Password Required"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
