"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { getInitials } from "@/lib/format";
import {
  FACE_MESH_NODES,
  FACE_MESH_EDGES,
  getNormalizedSpiderPos,
  getSpiderKneePoint,
  detectFaceInVideoFrame,
  DetectedFaceBox,
} from "@/lib/faceMesh";
import {
  api,
  ContinuousFaceResult,
  ContinuousEntranceFrameResponse,
  GatePassageRecord,
  GateStatusResponse,
  StationRecord,
  EmployeeRecord,
  getStoredUser,
  isAdminRole,
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
    if (isAdminRole(user?.role)) {
      setAdminUnlocked(true);
    }
  }, []);

  const isAdmin = isAdminRole(currentUser?.role) || adminUnlocked;

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
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const localFaceRef = useRef<DetectedFaceBox | null>(null);
  const localMissCountRef = useRef<number>(0);
  const smoothedBoxesRef = useRef<Record<string, { x: number; y: number; w: number; h: number }>>({});
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
        }).catch(() => { });
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
        }).catch(() => { });
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
          videoRef.current?.play().catch(() => { });
        };
        videoRef.current.play().catch(() => { });
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
        try { track.stop(); } catch { }
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

  // Smoothly draw live Bounding Boxes, 26-Node Mesh, Spider Crawler & On-Face Process HUD
  const drawOverlays = useCallback(
    (faces: ContinuousFaceResult[]) => {
      const canvas = overlayCanvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const cw = video.videoWidth || 640;
      const ch = video.videoHeight || 480;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Build unified render targets: use server faces when present, or real-time local face tracker when streaming
      const localDet = localFaceRef.current;
      const usingLocalFallback = faces.length === 0 && localDet !== null && isStreamingRef.current;

      const renderItems: Array<{
        key: string;
        targetX: number;
        targetY: number;
        targetW: number;
        targetH: number;
        face: ContinuousFaceResult | null;
      }> = [];

      if (usingLocalFallback && localDet) {
        const lx = (localDet.x / 640) * canvas.width;
        const ly = (localDet.y / 480) * canvas.height;
        const lw = (localDet.w / 640) * canvas.width;
        const lh = (localDet.h / 480) * canvas.height;
        renderItems.push({
          key: "local-face",
          targetX: lx,
          targetY: ly,
          targetW: lw,
          targetH: lh,
          face: null,
        });
      } else {
        const sw = streamDimsRef.current.w || canvas.width;
        const sh = streamDimsRef.current.h || canvas.height;
        const scaleX = canvas.width / sw;
        const scaleY = canvas.height / sh;

        faces.forEach((face) => {
          const bx = Math.round(face.bounding_box.x * scaleX);
          const by = Math.round(face.bounding_box.y * scaleY);
          const bw = Math.round(face.bounding_box.w * scaleX);
          const bh = Math.round(face.bounding_box.h * scaleY);
          let targetX = isMirrored ? Math.max(0, canvas.width - (bx + bw)) : bx;
          let targetY = by;
          let targetW = bw;
          let targetH = bh;

          // If single face & live local tracker is locked onto the same person, blend for instant 60fps follow
          if (faces.length === 1 && localDet && isStreamingRef.current) {
            const lx = (localDet.x / 640) * canvas.width;
            const ly = (localDet.y / 480) * canvas.height;
            const lw = (localDet.w / 640) * canvas.width;
            const lh = (localDet.h / 480) * canvas.height;
            const dist = Math.hypot(
              lx + lw * 0.5 - (targetX + targetW * 0.5),
              ly + lh * 0.5 - (targetY + targetH * 0.5)
            );
            if (dist < canvas.width * 0.32) {
              targetX = targetX * 0.45 + lx * 0.55;
              targetY = targetY * 0.45 + ly * 0.55;
              targetW = targetW * 0.55 + lw * 0.45;
              targetH = targetH * 0.55 + lh * 0.45;
            }
          }

          renderItems.push({
            key: `track-${face.track_id}`,
            targetX,
            targetY,
            targetW,
            targetH,
            face,
          });
        });
      }

      if (renderItems.length === 0) {
        return;
      }

      // Exponential smoothing per tracked face box so corners + spider glide with the real face
      const activeKeys = new Set<string>();
      const nextSmoothed: Record<string, { x: number; y: number; w: number; h: number }> = {};

      renderItems.forEach((item) => {
        activeKeys.add(item.key);
        const prev = smoothedBoxesRef.current[item.key];
        let smoothed: { x: number; y: number; w: number; h: number };
        if (prev) {
          const prevCx = prev.x + prev.w * 0.5;
          const prevCy = prev.y + prev.h * 0.5;
          const nextCx = item.targetX + item.targetW * 0.5;
          const nextCy = item.targetY + item.targetH * 0.5;
          const centerDist = Math.hypot(nextCx - prevCx, nextCy - prevCy);
          const sizeDelta = Math.abs(item.targetW - prev.w) + Math.abs(item.targetH - prev.h);
          if (centerDist < 2.5 && sizeDelta < 4) {
            smoothed = prev;
          } else {
            smoothed = {
              x: prev.x + (item.targetX - prev.x) * 0.32,
              y: prev.y + (item.targetY - prev.y) * 0.32,
              w: prev.w + (item.targetW - prev.w) * 0.32,
              h: prev.h + (item.targetH - prev.h) * 0.32,
            };
          }
        } else {
          smoothed = { x: item.targetX, y: item.targetY, w: item.targetW, h: item.targetH };
        }
        nextSmoothed[item.key] = smoothed;

        const drawX = Math.round(smoothed.x);
        const y = Math.round(smoothed.y);
        const w = Math.max(40, Math.round(smoothed.w));
        const h = Math.max(48, Math.round(smoothed.h));
        const face = item.face;

        let strokeColor = "#38BDF8"; // Sky blue when face locked locally
        let fillColor = "rgba(56, 189, 248, 0.10)";
        let tagText = "STEP 1/5 · FACE DETECTED";

        const actionStatus = face?.action_status || "LOCAL_DETECT";

        if (!face) {
          strokeColor = "#38BDF8";
          fillColor = "rgba(56, 189, 248, 0.11)";
          tagText = "STEP 1/5 · LOCALIZING FACE";
        } else if (actionStatus === "CONFIRMED") {
          strokeColor = "#10b981";
          fillColor = "rgba(16, 185, 129, 0.16)";
          tagText = face.attendance_action === "CHECK_OUT" ? "STEP 5/5 · CHECK-OUT CONFIRMED" : "STEP 5/5 · PASSAGE CONFIRMED";
        } else if (actionStatus === "REJECTED") {
          strokeColor = "#ef4444";
          fillColor = "rgba(239, 68, 68, 0.20)";
          tagText = "RECOGNITION REJECTED";
        } else if (actionStatus === "INACTIVE_BLOCKED") {
          strokeColor = "#dc2626";
          fillColor = "rgba(220, 38, 38, 0.20)";
          tagText = "EMPLOYEE INACTIVE";
        } else if (actionStatus === "SPOOF_BLOCKED") {
          strokeColor = "#dc2626";
          fillColor = "rgba(220, 38, 38, 0.22)";
          tagText = "STEP 3/5 · SPOOF BLOCKED";
        } else if (actionStatus === "CONSENT_BLOCKED" || face.status === "CONSENT_NOT_VERIFIED") {
          strokeColor = "#dc2626";
          fillColor = "rgba(220, 38, 38, 0.22)";
          tagText = "STEP 4/5 · CONSENT NOT VERIFIED";
        } else if (actionStatus === "COOLDOWN_ACTIVE") {
          strokeColor = "#f59e0b";
          fillColor = "rgba(245, 158, 11, 0.15)";
          tagText = "PLEASE WAIT (COOLDOWN)";
        } else if (actionStatus === "ACQUIRING_TRACK") {
          strokeColor = "#0284c7";
          fillColor = "rgba(2, 132, 199, 0.15)";
          const targetFrames = gateStatus?.min_persistence_frames || 3;
          tagText = `STEP 2/5 · TRACKING (${face.frames_seen || 1}/${targetFrames})`;
        } else if (actionStatus === "ALREADY_PUNCHED_IN_PASSAGE") {
          strokeColor = "#059669";
          fillColor = "rgba(5, 150, 105, 0.14)";
          tagText = "STEP 5/5 · PASSAGE RECORDED";
        } else if (actionStatus === "ALREADY_CHECKED_IN") {
          strokeColor = "#0891b2";
          fillColor = "rgba(8, 145, 178, 0.14)";
          tagText = "STEP 5/5 · ALREADY CHECKED IN";
        } else if (actionStatus === "NO_OPEN_SESSION") {
          strokeColor = "#db2777";
          fillColor = "rgba(219, 39, 119, 0.14)";
          tagText = "NO OPEN SESSION (CANNOT EXIT)";
        } else if (actionStatus === "STATIONARY_LINGER") {
          strokeColor = "#7c3aed";
          fillColor = "rgba(124, 58, 237, 0.14)";
          tagText = "STEP FORWARD TO REGISTER";
        } else if (actionStatus === "UNKNOWN_VISITOR" || face.status === "UNKNOWN_FACE") {
          strokeColor = "#f43f5e";
          fillColor = "rgba(244, 63, 94, 0.16)";
          tagText = "STEP 3/5 · UNKNOWN VISITOR";
        } else if (
          actionStatus === "UNCERTAIN_TRACK" ||
          actionStatus === "UNCERTAIN_CANDIDATE" ||
          face.status === "UNCERTAIN_MATCH"
        ) {
          strokeColor = "#eab308";
          fillColor = "rgba(234, 179, 8, 0.15)";
          tagText = "STEP 3/5 · VERIFYING ALIGNMENT";
        } else {
          strokeColor = "#818CF8";
          fillColor = "rgba(129, 140, 248, 0.12)";
          tagText = "STEP 1/5 · ANALYZING FACE";
        }

        // Crisp unobstructed corner-bracket box directly around detected face
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = strokeColor;
        ctx.globalAlpha = 0.38;
        ctx.strokeRect(drawX, y, w, h);
        ctx.globalAlpha = 1;

        ctx.fillStyle = fillColor;
        ctx.fillRect(drawX, y, w, h);

        // Sharp bold L-shaped corner markers
        const cornerLen = Math.min(20, Math.max(12, Math.round(w * 0.17)));
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = strokeColor;
        ctx.beginPath();
        ctx.moveTo(drawX, y + cornerLen);
        ctx.lineTo(drawX, y);
        ctx.lineTo(drawX + cornerLen, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(drawX + w - cornerLen, y);
        ctx.lineTo(drawX + w, y);
        ctx.lineTo(drawX + w, y + cornerLen);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(drawX, y + h - cornerLen);
        ctx.lineTo(drawX, y + h);
        ctx.lineTo(drawX + cornerLen, y + h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(drawX + w - cornerLen, y + h);
        ctx.lineTo(drawX + w, y + h);
        ctx.lineTo(drawX + w, y + h - cornerLen);
        ctx.stroke();

        // Articulated 8-leg spider-web scan overlay strictly on detected face coordinates
        const isActiveTrack =
          !face ||
          actionStatus === "NONE" ||
          actionStatus === "ACQUIRING_TRACK" ||
          actionStatus === "UNCERTAIN_TRACK" ||
          actionStatus === "UNCERTAIN_CANDIDATE" ||
          actionStatus === "UNKNOWN_VISITOR";
        const isConfirmedLock =
          Boolean(face) &&
          (actionStatus === "CONFIRMED" ||
            actionStatus === "ALREADY_CHECKED_IN" ||
            actionStatus === "ALREADY_PUNCHED_IN_PASSAGE");

        if (isActiveTrack || isConfirmedLock) {
          const trackSeed = face ? face.track_id * 1.35 : 0.4;
          const phase = performance.now() * 0.0022 + trackSeed;
          const normPos = getNormalizedSpiderPos(phase);
          const sx = drawX + normPos.x * w;
          const sy = y + normPos.y * h;

          const meshNodes = FACE_MESH_NODES.map((pt) => ({
            nx: drawX + pt.x * w,
            ny: y + pt.y * h,
          }));

          // Calm bidirectional optical scanline sweep across active tracked face
          if (isActiveTrack) {
            const sweepProgress = 0.5 - 0.5 * Math.cos(phase * 0.8);
            const sweepY = y + 3 + sweepProgress * Math.max(8, h - 6);
            const grad = ctx.createLinearGradient(drawX, Math.max(y, sweepY - 14), drawX, sweepY);
            grad.addColorStop(0, "rgba(129, 140, 248, 0)");
            grad.addColorStop(
              1,
              actionStatus === "UNKNOWN_VISITOR" ? "rgba(244, 63, 94, 0.25)" : "rgba(129, 140, 248, 0.30)"
            );
            ctx.fillStyle = grad;
            ctx.fillRect(drawX + 3, Math.max(y + 2, sweepY - 14), Math.max(0, w - 6), Math.min(14, sweepY - y));

            ctx.strokeStyle = actionStatus === "UNKNOWN_VISITOR" ? "#FDA4AF" : "#E0E7FF";
            ctx.lineWidth = 1.6;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.moveTo(drawX + 3, sweepY);
            ctx.lineTo(drawX + w - 3, sweepY);
            ctx.stroke();
          }

          // Interconnected 26-node web edges across the face
          ctx.lineWidth = 1.05;
          for (let i = 0; i < FACE_MESH_EDGES.length; i++) {
            const [aIdx, bIdx] = FACE_MESH_EDGES[i];
            const a = meshNodes[aIdx];
            const b = meshNodes[bIdx];
            const mx = (a.nx + b.nx) * 0.5;
            const my = (a.ny + b.ny) * 0.5;
            const prox = isActiveTrack
              ? Math.max(0, 1 - Math.hypot(mx - sx, my - sy) / Math.max(46, w * 0.65))
              : 0.45;
            ctx.strokeStyle = isActiveTrack ? strokeColor : "#10B981";
            ctx.globalAlpha = isActiveTrack ? 0.22 + prox * 0.52 : 0.4;
            ctx.beginPath();
            ctx.moveTo(a.nx, a.ny);
            ctx.lineTo(b.nx, b.ny);
            ctx.stroke();
          }

          // Anatomical facial landmark dots
          for (let i = 0; i < meshNodes.length; i++) {
            const pt = meshNodes[i];
            const prox = isActiveTrack
              ? Math.max(0, 1 - Math.hypot(pt.nx - sx, pt.ny - sy) / Math.max(46, w * 0.65))
              : 0.5;
            ctx.fillStyle = isConfirmedLock ? "#34D399" : "#FFFFFF";
            ctx.globalAlpha = isActiveTrack ? 0.44 + prox * 0.52 : 0.85;
            ctx.beginPath();
            ctx.arc(pt.nx, pt.ny, 1.8 + prox * 1.1, 0, Math.PI * 2);
            ctx.fill();
          }

          // 8-leg articulated crawling spider sensor across each scanning face
          if (isActiveTrack) {
            const sorted = meshNodes
              .map((pt, idx) => ({ idx, d: Math.hypot(pt.nx - sx, pt.ny - sy) }))
              .sort((a, b) => a.d - b.d);

            ctx.strokeStyle = actionStatus === "UNKNOWN_VISITOR" ? "#FECDD3" : "#E0E7FF";
            ctx.lineWidth = 1.3;
            for (let leg = 0; leg < 8; leg++) {
              const target = meshNodes[sorted[leg].idx];
              const { kx, ky } = getSpiderKneePoint(sx, sy, target.nx, target.ny, leg, Math.max(5, w * 0.06));
              ctx.globalAlpha = Math.max(0.36, 0.92 - sorted[leg].d / Math.max(56, w * 0.85));
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.lineTo(kx, ky);
              ctx.lineTo(target.nx, target.ny);
              ctx.stroke();
            }

            const haloR = 5.4 + Math.sin(phase * 2.0) * 0.5;
            ctx.globalAlpha = 0.82;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(sx, sy, haloR, 0, Math.PI * 2);
            ctx.stroke();

            ctx.globalAlpha = 0.98;
            ctx.fillStyle = "#FFFFFF";
            ctx.beginPath();
            ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }

        // Top Tag Badge attached directly to this person's face box
        let name = tagText;
        let sub = face
          ? `Track #${face.track_id} • ${face.motion_direction || "ACQUIRING"}`
          : `Live Lock (${drawX}, ${y}) • Running liveness check...`;

        if (face?.employee) {
          if (actionStatus === "CONFIRMED") {
            name = `${face.employee.full_name} • ${face.attendance_action === "CHECK_OUT" ? "OUT" : "IN"}`;
            sub = `STEP 5/5 • ${face.employee.employee_number} • ${Math.round(face.recognition_score * 100)}% • ${face.motion_direction || "APPROACHING"}`;
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
            name = `${face.employee.full_name} · STEP 2/5`;
            sub = `Tracking ${face.frames_seen || 1}/${gateStatus?.min_persistence_frames || 3} • ${face.employee.employee_number}`;
          } else {
            name = face.employee.full_name;
            sub = `${face.employee.employee_number} • ${Math.round(face.recognition_score * 100)}% • ${tagText}`;
          }
        }

        const tagWidth = Math.max(186, w);
        const tagX = Math.max(0, Math.min(canvas.width - tagWidth, drawX));
        const tagY = y >= 36 ? y - 32 : Math.min(canvas.height - 32, y + h + 4);
        ctx.fillStyle = "rgba(11, 15, 23, 0.94)";
        ctx.fillRect(tagX, tagY, tagWidth, 30);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(tagX, tagY, tagWidth, 30);
        ctx.fillStyle = strokeColor;
        ctx.fillRect(tagX, tagY, 4, 30);

        ctx.fillStyle = "#ffffff";
        ctx.font = "700 11.5px Inter, sans-serif";
        ctx.fillText(name, tagX + 9, tagY + 13.5);

        ctx.fillStyle = "#cbd5e1";
        ctx.font = "600 9px monospace";
        ctx.fillText(sub, tagX + 9, tagY + 25.5);

        if (face && actionStatus === "CONFIRMED" && face.attendance_action) {
          ctx.fillStyle = face.attendance_action === "CHECK_IN" ? "rgba(5, 150, 105, 0.92)" : "rgba(79, 70, 229, 0.92)";
          ctx.fillRect(drawX, y + h + 2, Math.max(132, w * 0.85), 18);
          ctx.fillStyle = "#ffffff";
          ctx.font = "600 9.5px monospace";
          ctx.fillText(
            `${face.attendance_action} ${face.is_late ? "(LATE)" : "(ON TIME)"}`,
            drawX + 6,
            y + h + 14
          );
        }
      });

      smoothedBoxesRef.current = nextSmoothed;
    },
    [isMirrored, gateStatus]
  );

  // Instant ~12 Hz client-side face locator so bounding box & spider track movement immediately
  useEffect(() => {
    if (!isStreaming) {
      localFaceRef.current = null;
      localMissCountRef.current = 0;
      return;
    }

    let cancelled = false;
    let busy = false;
    const probeLocal = async () => {
      if (cancelled || busy || !videoRef.current || !scratchCanvasRef.current) return;
      busy = true;
      try {
        const det = await detectFaceInVideoFrame(
          videoRef.current,
          scratchCanvasRef.current,
          isMirrored
        );
        if (cancelled) return;
        if (det) {
          localFaceRef.current = det;
          localMissCountRef.current = 0;
        } else {
          localMissCountRef.current += 1;
          if (localMissCountRef.current >= 3) {
            localFaceRef.current = null;
          }
        }
      } finally {
        busy = false;
      }
    };

    void probeLocal();
    const timer = setInterval(() => {
      void probeLocal();
    }, 85);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isStreaming, isMirrored]);

  // Animate live spider-mesh bounding overlays smoothly whenever stream or tracked faces are active
  useEffect(() => {
    if (!isStreaming && detectedFaces.length === 0) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      drawOverlays(detectedFaces);
      return;
    }

    let rafId = 0;
    const renderLoop = () => {
      drawOverlays(detectedFaces);
      rafId = requestAnimationFrame(renderLoop);
    };
    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [isStreaming, isMirrored, detectedFaces, drawOverlays]);

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

      if (!isMountedRef.current) return;
      const tookMs = Math.round(performance.now() - startTime);
      setLatencyMs(tookMs);
      setStreamError(null);
      if (!isStreamingRef.current) {
        streamDimsRef.current = { w: 640, h: 480 };
      }
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
    <div className="space-y-4 text-slate-900">
      <canvas ref={canvasRef} className="hidden" />

      {/* Ledger Noir Light Operator Control Strip */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-2.5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight text-slate-900">
                  Gate Monitor
                </h1>
                {transportMode === "WEBSOCKET" && isWsConnected ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 tabular-nums">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>WS Live{rttMs !== null ? ` · ${rttMs}ms` : ""}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 tabular-nums">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <span>HTTP Poll{rttMs !== null ? ` · ${rttMs}ms` : ""}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Multi-person optical entrance tracking and autonomous check-in/out stream.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Station Selector */}
            <div className="flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] px-2.5 h-8 text-xs">
              <Building2 className="h-3.5 w-3.5 text-[#4F46E5] shrink-0" />
              <select
                value={selectedStation}
                onChange={(e) => setSelectedStation(e.target.value)}
                aria-label="Gate Station"
                className="font-medium text-slate-800 bg-transparent focus:outline-none"
              >
                {stations.length > 0 ? (
                  stations.map((s) => (
                    <option key={s.id} value={s.station_code} className="bg-white text-slate-900">
                      {s.station_code} — {s.name}
                    </option>
                  ))
                ) : (
                  <option value="ST-GATE-01" className="bg-white text-slate-900">
                    ST-GATE-01 — Main Campus Gate
                  </option>
                )}
              </select>
            </div>

            {/* Direction Mode Segmented Control */}
            <div className="inline-flex h-8 items-center rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => handleModeChange("IN")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${gateMode === "IN"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                  }`}
              >
                Entry
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("AUTO_DETECT")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${gateMode === "AUTO_DETECT"
                    ? "bg-[#4F46E5] text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                  }`}
              >
                Auto
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("OUT")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${gateMode === "OUT"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
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
                  ctx?.resume().then(() => setIsAudioSuspended(false)).catch(() => { });
                }}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
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
                  ctx?.resume().then(() => setIsAudioSuspended(false)).catch(() => { });
                }
              }}
              title={soundEnabled ? "Mute Gate Chime" : "Enable Gate Chime"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] text-slate-600 hover:bg-slate-100 transition-colors"
            >
              {soundEnabled ? (
                <Volume2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <VolumeX className="h-3.5 w-3.5 text-slate-400" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              title="Configure Gate Timing & Persistence"
            >
              <Sliders className="h-3.5 w-3.5 text-slate-500" />
              <span className="hidden sm:inline">Tuning</span>
              {!isAdmin && <Lock className="h-3 w-3 text-amber-600" />}
            </button>

            <button
              type="button"
              onClick={() => {
                fetchGateData();
                handleReconnectTransport();
              }}
              disabled={isTestingPing}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
              title="Refresh data & reconnect stream"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isTestingPing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Quiet Timing Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EAECEF] pt-2.5 text-[11px] text-slate-500">
          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 hover:text-slate-900 transition-colors"
            >
              <Clock className="h-3 w-3 text-amber-600" />
              <span>Checkout Debounce: <strong className="text-slate-800">{minCheckoutMins}m</strong></span>
            </button>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 hover:text-slate-900 transition-colors"
            >
              <Layers className="h-3 w-3 text-[#4F46E5]" />
              <span>Persistence: <strong className="text-slate-800">{minPersistenceFrames}f</strong></span>
            </button>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 hover:text-slate-900 transition-colors"
            >
              <ShieldAlert className="h-3 w-3 text-slate-500" />
              <span>Cooldown: <strong className="text-slate-800">{cooldownSec}s</strong></span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowSimTools(!showSimTools)}
            className="text-[#4F46E5] hover:text-[#4338CA] font-medium transition-colors"
          >
            {showSimTools ? "Hide simulation" : "Simulation tools"}
          </button>
        </div>
      </div>

      {simMessage && (
        <div
          className={`px-3.5 py-2.5 rounded-lg border text-xs flex items-center justify-between ${simMessage.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-amber-50 text-amber-800 border-amber-200"
            }`}
        >
          <div className="flex items-center gap-2">
            {simMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
            )}
            <span>{simMessage.text}</span>
          </div>
          <button onClick={() => setSimMessage(null)} className="text-xs font-medium underline hover:opacity-80">
            Dismiss
          </button>
        </div>
      )}

      {streamError && !insecureContextInfo && (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{streamError}</span>
        </div>
      )}

      {/* Main Ledger Noir Light Grid: 8 Col Optical Scanner Frame + 4 Col Live Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left: Optical Stream (CameraCapture Sibling) + 4-Stat Telemetry Bar */}
        <div className="lg:col-span-8 space-y-3">
          <div className="rounded-2xl bg-[#0D1117] border border-[#E5E7EB] shadow-[0_1px_3px_rgba(15,23,42,0.06)] p-2.5">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#070A0F] flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover transition-transform duration-150 ${isMirrored ? "-scale-x-100" : ""
                  } ${isStreaming ? "block" : "opacity-0 pointer-events-none absolute inset-0"}`}
              />

              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none z-10"
              />
              <canvas ref={scratchCanvasRef} className="hidden" />

              {/* Subtle outer standby corner guides only while searching without server tracks */}
              {isStreaming && detectedFaces.length === 0 && !insecureContextInfo && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                  <svg className="h-full w-full" viewBox="0 0 640 480" fill="none">
                    <g
                      stroke="rgba(148,163,184,0.38)"
                      strokeWidth="1.75"
                      strokeLinecap="square"
                    >
                      <path d="M 28 56 L 28 28 L 56 28" />
                      <path d="M 584 28 L 612 28 L 612 56" />
                      <path d="M 28 424 L 28 452 L 56 452" />
                      <path d="M 584 452 L 612 452 L 612 424" />
                    </g>
                  </svg>
                </div>
              )}

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
              ) : !isStreaming && detectedFaces.length === 0 ? (
                <div className="text-center p-6 space-y-3 z-0">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#121826] text-indigo-400 border border-[#1E293B]">
                    <Radio className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">
                      Gate Monitor Standby
                    </h3>
                    <p className="text-xs text-slate-400 max-w-sm mt-1">
                      Start the live optical stream or trigger a preset in Simulation Tools below to test multi-person spider-mesh scanning.
                    </p>
                  </div>
                  <Button onClick={startCamera} size="sm" variant="primary">
                    <Play className="h-3.5 w-3.5" />
                    <span>Start Optical Stream</span>
                  </Button>
                </div>
              ) : null}

              {(isStreaming || detectedFaces.length > 0) && !insecureContextInfo && (
                <>
                  {/* Top-Left Stream Readout */}
                  <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-1.5">
                    {isStreaming ? (
                      <span className="flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-[11px] font-mono text-emerald-400 backdrop-blur-sm border border-white/10 tabular-nums">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                        </span>
                        <span>LIVE · {fps} FPS</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-[11px] font-mono text-indigo-300 backdrop-blur-sm border border-indigo-400/25 tabular-nums">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-400" />
                        </span>
                        <span>SIMULATION · CROWD</span>
                      </span>
                    )}
                    <span className="rounded-md bg-black/65 px-2 py-1 text-[11px] font-mono text-slate-300 backdrop-blur-sm border border-white/10 tabular-nums">
                      {latencyMs}ms
                    </span>
                  </div>

                  {/* Top-Right Active Faces Pill */}
                  <div className="absolute top-3 right-3 z-20">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm border tabular-nums ${detectedFaces.length > 0
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
                </>
              )}
            </div>

            {/* Integrated Dark Optical Control Bar (matches CameraCapture) */}
            <div className="pt-2.5 px-1 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <span className="text-indigo-400 font-medium">{selectedStation}</span>
                <span className="text-slate-600">|</span>
                <span className="text-emerald-400">{gateMode}</span>
                <span className="text-slate-600 hidden sm:inline">|</span>
                <span className="text-slate-400 hidden sm:inline">
                  {isStreaming
                    ? isMirrored
                      ? "MIRRORED"
                      : "DIRECT"
                    : detectedFaces.length > 0
                      ? "CROWD SIM"
                      : "STANDBY"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {isStreaming ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsMirrored(!isMirrored)}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2.5 text-[11px] font-medium text-slate-200 hover:bg-white/15 transition-colors"
                    >
                      <FlipHorizontal className="h-3 w-3 text-slate-300" />
                      <span>{isMirrored ? "Mirrored" : "Direct"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenQuickEnroll}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2.5 text-[11px] font-medium text-slate-200 hover:bg-white/15 transition-colors"
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
                  </>
                ) : (
                  <>
                    {detectedFaces.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setDetectedFaces([]);
                          clearOverlays();
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2.5 text-[11px] font-medium text-slate-200 hover:bg-white/15 transition-colors"
                      >
                        <X className="h-3 w-3 text-slate-300" />
                        <span>Clear Sim</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={startCamera}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#4F46E5] hover:bg-[#4338CA] px-3 text-[11px] font-medium text-white transition-colors"
                    >
                      <Play className="h-3 w-3" />
                      <span>Start Stream</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Bottom 4-Stat Telemetry Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-slate-500">
                Total Scans
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
                {gateStatus?.today_total_passages ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-emerald-600">
                Entries
              </p>
              <p className="mt-1 text-xl font-semibold text-emerald-600 tabular-nums">
                {gateStatus?.today_checkins ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-[#4F46E5]">
                Exits
              </p>
              <p className="mt-1 text-xl font-semibold text-[#4F46E5] tabular-nums">
                {gateStatus?.today_checkouts ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-rose-600">
                Rejected Frame
              </p>
              <p className="mt-1 text-xl font-semibold text-rose-600 tabular-nums">
                {rejectedCount}
              </p>
            </div>
          </div>

          {/* Collapsible Light Simulation Sandbox */}
          {showSimTools && (
            <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#EAECEF] flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">Crowd Simulation Sandbox</h3>
                  <p className="text-[11px] text-slate-500">
                    Test multi-face detection, spider-mesh tracking, and debounce without optical hardware.
                  </p>
                </div>
                <span className="rounded border border-[#E5E7EB] bg-[#FAFBFD] px-2 py-0.5 text-[10px] font-mono text-slate-500">
                  MOCK
                </span>
              </div>
              <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => runSimulation(["EIPC-EMP-001", "EIPC-EMP-002"], "2 Staff Entering Together")}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 hover:border-slate-300 disabled:opacity-50 transition-colors"
                >
                  <Users className="h-3 w-3 text-emerald-600" />
                  <span>Abebe + Hanna</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => runSimulation(["EIPC-EMP-003"], "Solo Staff Fast Passage")}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 hover:border-slate-300 disabled:opacity-50 transition-colors"
                >
                  <UserCheck className="h-3 w-3 text-[#4F46E5]" />
                  <span>Chaltu Girma</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => runSimulation(["EIPC-EMP-004", "UNKNOWN_VISITOR"], "Staff + Unknown Visitor")}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 hover:border-slate-300 disabled:opacity-50 transition-colors"
                >
                  <UserX className="h-3 w-3 text-rose-600" />
                  <span>Staff + Visitor</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => runSimulation(["EIPC-EMP-001", "EIPC-EMP-002", "EIPC-EMP-003"], "3 Staff Crowd")}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 hover:border-slate-300 disabled:opacity-50 transition-colors"
                >
                  <Layers className="h-3 w-3 text-amber-600" />
                  <span>3-Person Crowd</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Active Detections + Last 25 Passages */}
        <div className="lg:col-span-4 space-y-4">
          {/* 5-Stage Continuous Gate Tracking Sequence */}
          {(() => {
            const minPersist = gateStatus?.min_persistence_frames || 3;
            const hasDetections = detectedFaces.length > 0;
            const hasTracked = detectedFaces.some(
              (f) => f.matched || f.action_status === "CONFIRMED" || (f.frames_seen || 0) >= minPersist
            );
            const hasAcquiring = detectedFaces.some((f) => f.action_status === "ACQUIRING_TRACK");
            const hasMatched = detectedFaces.some((f) => f.matched && f.liveness_passed);
            const hasBlocked = detectedFaces.some((f) =>
              ["SPOOF_BLOCKED", "INACTIVE_BLOCKED", "CONSENT_BLOCKED", "REJECTED"].includes(
                f.action_status || ""
              )
            );
            const hasConfirmed = detectedFaces.some((f) => f.action_status === "CONFIRMED");

            const gateSteps = [
              {
                n: "01",
                label: "Face Detect",
                state: hasDetections ? "PASSED" : isStreaming ? "ACTIVE" : "IDLE",
              },
              {
                n: "02",
                label: `Track (${minPersist}f)`,
                state: hasTracked ? "PASSED" : hasAcquiring ? "ACTIVE" : "IDLE",
              },
              {
                n: "03",
                label: "Match & Live",
                state: hasMatched ? "PASSED" : hasBlocked ? "FAILED" : "IDLE",
              },
              {
                n: "04",
                label: "Consent/Dir",
                state: hasConfirmed
                  ? "PASSED"
                  : detectedFaces.some((f) => f.action_status === "CONSENT_BLOCKED")
                    ? "FAILED"
                    : hasMatched
                      ? "ACTIVE"
                      : "IDLE",
              },
              {
                n: "05",
                label: "Auto Commit",
                state: hasConfirmed ? "PASSED" : "IDLE",
              },
            ];

            return (
              <div className="rounded-xl border border-[#E5E7EB] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    Continuous Gate Sequence (1–5)
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {isStreaming ? "STREAM LIVE" : "STANDBY"}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {gateSteps.map((gs) => {
                    const cls =
                      gs.state === "PASSED"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : gs.state === "FAILED"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : gs.state === "ACTIVE"
                            ? "border-indigo-200 bg-[#EEF2FF] text-[#4338CA]"
                            : "border-[#EAECEF] bg-[#FAFBFD] text-slate-400";
                    return (
                      <div key={gs.n} className={`rounded-md border px-1 py-1.5 text-center ${cls}`}>
                        <div className="font-mono text-[10px] font-semibold">{gs.n}</div>
                        <div className="text-[9px] font-medium truncate mt-0.5">{gs.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Active Frame Detections */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#EAECEF] flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-emerald-600" />
                <span>Active Frame Detections</span>
              </h2>
              <span className="rounded-md border border-[#E5E7EB] bg-[#FAFBFD] px-2 py-0.5 text-[10px] font-mono text-slate-600 tabular-nums">
                {detectedFaces.length} Active
              </span>
            </div>
            <div className="p-3">
              {detectedFaces.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">
                  {isStreaming
                    ? "Monitoring camera view for incoming faces..."
                    : "Stream offline. Start stream or run simulation to inspect active detections."}
                </div>
              ) : (
                <div className="space-y-2">
                  {detectedFaces.map((face) => (
                    <div
                      key={face.track_id}
                      className="p-2.5 rounded-lg border border-[#EAECEF] bg-[#FAFBFD] flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-900 truncate">
                            {face.employee ? face.employee.full_name : "Unrecognized Visitor"}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                          {Math.round(face.recognition_score * 100)}% ·{" "}
                          <span className={face.liveness_passed ? "text-emerald-600 font-medium" : "text-rose-600 font-medium"}>
                            {face.liveness_passed ? "LIVE" : "SPOOF"}
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5">
                        {face.action_status === "CONFIRMED" ? (
                          <span className="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                            {face.attendance_action}
                          </span>
                        ) : face.action_status === "REJECTED" ||
                          face.action_status === "INACTIVE_BLOCKED" ||
                          face.action_status === "SPOOF_BLOCKED" ||
                          face.action_status === "CONSENT_BLOCKED" ||
                          face.status === "CONSENT_NOT_VERIFIED" ? (
                          <span className="rounded bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                            {face.action_status?.replace(/_/g, " ") || "BLOCKED"}
                          </span>
                        ) : face.action_status === "COOLDOWN_ACTIVE" ||
                          face.action_status === "ALREADY_PUNCHED_IN_PASSAGE" ||
                          face.action_status === "UNCERTAIN_TRACK" ||
                          face.action_status === "NO_OPEN_SESSION" ? (
                          <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            {face.action_status === "NO_OPEN_SESSION" ? "NO SESSION" : "WAIT"}
                          </span>
                        ) : face.action_status === "ACQUIRING_TRACK" ? (
                          <span className="rounded bg-[#EEF2FF] border border-indigo-200 px-2 py-0.5 text-[10px] font-medium text-[#4338CA] tabular-nums">
                            {face.frames_seen || 1}/{gateStatus?.min_persistence_frames || 3}f
                          </span>
                        ) : face.action_status === "ALREADY_CHECKED_IN" ||
                          (face.matched && face.action_status !== "NONE") ? (
                          <span className="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                            VERIFIED
                          </span>
                        ) : face.action_status === "NONE" ? (
                          <span className="rounded bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                            DETECTING
                          </span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="rounded bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                              UNKNOWN
                            </span>
                            <button
                              type="button"
                              onClick={handleOpenQuickEnroll}
                              className="rounded border border-indigo-200 bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-medium text-[#4338CA] hover:bg-indigo-100"
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
          <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#EAECEF] flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-[#4F46E5]" />
                <span>Recent Passages (Last 25)</span>
              </h2>
              <span className="text-[10px] font-mono text-slate-500">LIVE FEED</span>
            </div>
            <div className="divide-y divide-[#EAECEF] max-h-[400px] overflow-y-auto">
              {recentPassages.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  No gate passages recorded yet today.
                </div>
              ) : (
                recentPassages.map((p, idx) => (
                  <div
                    key={idx}
                    className="px-3.5 py-2.5 hover:bg-[#FAFBFD] flex items-center justify-between gap-2 text-xs transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-7 w-7 rounded-full bg-[#EEF2FF] text-[#4338CA] font-semibold flex items-center justify-center text-[10px] shrink-0 border border-indigo-100">
                        {getInitials(p.employee_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{p.employee_name}</p>
                        <p className="text-[10.5px] font-mono text-slate-500 truncate">
                          {p.employee_number} · {p.department || "Staff"}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-0.5">
                      <div className="flex items-center gap-1 justify-end">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9.5px] font-medium ${p.event_type === "CHECK_IN"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-[#EEF2FF] text-[#4338CA] border border-indigo-200"
                            }`}
                        >
                          {p.event_type === "CHECK_IN" ? "IN" : "OUT"}
                        </span>
                        {p.is_late && (
                          <span className="rounded bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 text-[9.5px] font-medium">
                            LATE
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-slate-400 tabular-nums">
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

      {/* Quick Gate Face Enrollment Modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-xl space-y-4 text-slate-900">
            <div className="flex items-center justify-between border-b border-[#EAECEF] pb-3">
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Quick Gate Face Enrollment</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Link captured snapshot to enable continuous gate recognition.
                </p>
              </div>
              <button
                onClick={() => setShowEnrollModal(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {enrollSnapshotB64 && (
              <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden border border-[#E5E7EB] bg-[#070A0F]">
                <img
                  src={enrollSnapshotB64}
                  alt="Captured face snapshot"
                  className={`w-full h-full object-cover ${isMirrored ? "-scale-x-100" : ""}`}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700">Employee Profile</label>
              <select
                value={enrollTargetEmpId}
                onChange={(e) => setEnrollTargetEmpId(e.target.value ? Number(e.target.value) : "")}
                className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] px-2.5 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
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
              <div className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs">
                {enrollError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#EAECEF]">
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
                disabled={!enrollTargetEmpId || isSubmittingEnroll}
              >
                Save Biometric Template
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Continuous Gate Tuning Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-xl space-y-4 text-slate-900">
            <div className="flex items-center justify-between border-b border-[#EAECEF] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Continuous Gate Tuning</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Timing debounce and persistence frame parameters.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin ? (
                  <span className="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    Admin Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    <Lock className="h-2.5 w-2.5" />
                    Admin Locked
                  </span>
                )}
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {!isAdmin && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
                <div className="font-medium flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <span>Administrator Step-Up Required</span>
                </div>
                <p className="text-[11px] text-amber-800/90 leading-relaxed">
                  Direction controls can be toggled freely, while cooldown and tracking persistence changes require System Administrator authorization.
                </p>
              </div>
            )}

            {tuningSaveError && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>{tuningSaveError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-slate-700">
                    Passage Cooldown (Seconds)
                  </label>
                  <span className="font-mono text-[#4F46E5] font-medium tabular-nums">
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
                  <label className="text-[11px] font-medium text-slate-700">
                    Accidental Checkout Debounce (Minutes)
                  </label>
                  <span className="font-mono text-[#4F46E5] font-medium tabular-nums">
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
                  <label className="text-[11px] font-medium text-slate-700">
                    Minimum Tracking Persistence (Frames)
                  </label>
                  <span className="font-mono text-[#4F46E5] font-medium tabular-nums">
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
                <div className="rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] p-3 space-y-1.5">
                  <label className="text-[11px] font-medium text-slate-700 block">
                    Admin Step-Up Password
                  </label>
                  <input
                    type="password"
                    value={adminPasswordInput}
                    onChange={(e) => setAdminPasswordInput(e.target.value)}
                    placeholder="Enter administrator password"
                    className="h-8 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-slate-900 focus:border-[#4F46E5] focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#EAECEF]">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsSettingsOpen(false)}
                disabled={isSavingTuning}
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
