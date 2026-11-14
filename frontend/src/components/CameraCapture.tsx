"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  Camera,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Zap,
  ShieldAlert,
  Lock,
  FlipHorizontal2,
} from "lucide-react";
import { Button } from "./ui/Button";
import {
  FACE_MESH_NODES,
  FACE_MESH_EDGES,
  getNormalizedSpiderPos,
  getSpiderKneePoint,
} from "@/lib/faceMesh";

const FACE_BOX_X = 224;
const FACE_BOX_Y = 120;
const FACE_BOX_W = 192;
const FACE_BOX_H = 240;
const SPIDER_LEG_COUNT = 8;

const VIEWBOX_FACE_NODES = FACE_MESH_NODES.map((pt) => ({
  cx: FACE_BOX_X + pt.x * FACE_BOX_W,
  cy: FACE_BOX_Y + pt.y * FACE_BOX_H,
  anchor: Boolean(pt.anchor),
}));

interface CameraCaptureProps {
  onCapture: (base64Image: string) => void;
  isProcessing?: boolean;
  autoScanIntervalMs?: number;
  guideText?: string;
  captureButtonText?: string;
  className?: string;
  scanState?: "idle" | "scanning" | "matched" | "error";
  showMirrorToggle?: boolean;
}

export function CameraCapture({
  onCapture,
  isProcessing = false,
  autoScanIntervalMs = 0,
  guideText = "Align face within the frame",
  captureButtonText = "Manual Shot",
  className = "",
  scanState,
  showMirrorToggle = true,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [streamActive, setStreamActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [insecureContextInfo, setInsecureContextInfo] = useState<{
    origin: string;
    protocol: string;
    host: string;
  } | null>(null);
  const [autoScanActive, setAutoScanActive] = useState(autoScanIntervalMs > 0);
  const [mirrored, setMirrored] = useState(true);
  const [, setLastCapturePreview] = useState<string | null>(null);
  const [captureSeq, setCaptureSeq] = useState(0);
  const isMountedRef = useRef<boolean>(true);
  const nodeCircleRefs = useRef<(SVGCircleElement | null)[]>([]);
  const edgeLineRefs = useRef<(SVGLineElement | null)[]>([]);
  const legPathRefs = useRef<(SVGPathElement | null)[]>([]);
  const spiderRingRef = useRef<SVGCircleElement | null>(null);
  const spiderCoreRef = useRef<SVGCircleElement | null>(null);
  const crawlerPhaseRef = useRef<number>(0);

  const effectiveScanState: "idle" | "scanning" | "matched" | "error" =
    scanState ?? (isProcessing ? "scanning" : "idle");

  const startCamera = useCallback(async () => {
    setErrorMsg(null);
    setInsecureContextInfo(null);
    try {
      if (typeof window !== "undefined") {
        const isLocal =
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1";
        if (!window.isSecureContext && !isLocal) {
          if (isMountedRef.current) {
            setInsecureContextInfo({
              origin: window.location.origin,
              protocol: window.location.protocol,
              host: window.location.host,
            });
          }
          throw new Error("INSECURE_CONTEXT");
        }
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser MediaDevices API is not supported in this environment.");
      }

      // Small 50ms yield to allow OS camera handle to be released by outgoing route
      await new Promise((r) => setTimeout(r, 50));
      if (!isMountedRef.current) return;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
      } catch (firstErr: unknown) {
        const errObj = firstErr as { name?: string };
        if (errObj?.name === "NotReadableError" || errObj?.name === "AbortError") {
          await new Promise((r) => setTimeout(r, 150));
          if (!isMountedRef.current) return;
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 640 },
              height: { ideal: 480 },
              facingMode: "user",
              frameRate: { ideal: 30 },
            },
            audio: false,
          });
        } else {
          throw firstErr;
        }
      }

      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
        return;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          if (isMountedRef.current) {
            videoRef.current?.play().catch(() => {});
            setStreamActive(true);
          }
        };
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const errObj = err as { message?: string; name?: string };
      console.error("Camera access error:", err);
      if (errObj?.message === "INSECURE_CONTEXT") {
        setErrorMsg("Insecure HTTP context detected. Browser requires HTTPS for camera access.");
      } else {
        setErrorMsg(
          errObj?.name === "NotAllowedError"
            ? "Camera permission denied. Please allow camera access in your browser settings."
            : `Failed to initialize camera: ${errObj?.message || "Unknown error"}`
        );
      }
      setStreamActive(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    isMountedRef.current = false;
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      videoRef.current.srcObject = null;
      setStreamActive(false);
    }
  }, []);

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !streamActive) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const b64 = canvas.toDataURL("image/jpeg", 0.92);
    setLastCapturePreview(b64);
    setCaptureSeq((s) => s + 1);
    onCapture(b64);
  }, [streamActive, onCapture]);

  useEffect(() => {
    isMountedRef.current = true;
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    if (!autoScanActive || !streamActive || isProcessing) return;
    const interval = autoScanIntervalMs > 0 ? autoScanIntervalMs : 1500;

    const timer = setInterval(() => {
      captureFrame();
    }, interval);

    return () => clearInterval(timer);
  }, [autoScanActive, streamActive, isProcessing, autoScanIntervalMs, captureFrame]);

  const bracketStroke =
    effectiveScanState === "matched"
      ? "#10B981"
      : effectiveScanState === "error"
      ? "#F43F5E"
      : effectiveScanState === "scanning"
      ? "#818CF8"
      : "rgba(255, 255, 255, 0.88)";

  const landmarkColor =
    effectiveScanState === "matched"
      ? "#34D399"
      : effectiveScanState === "error"
      ? "#FDA4AF"
      : "#FFFFFF";

  const isScanning = effectiveScanState === "scanning";
  const isMatched = effectiveScanState === "matched";
  const isError = effectiveScanState === "error";
  const isAutoWatching = autoScanActive && streamActive && effectiveScanState === "idle";
  const spiderActive = isScanning || isAutoWatching;
  const showWebMesh = spiderActive || isMatched || isError;

  // 60fps ref-driven articulated spider crawler moving across all facial zones
  useEffect(() => {
    if (!spiderActive) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    let rafId = 0;
    let lastTs = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      const phaseSpeed = isScanning ? 3.2 : 1.55;
      crawlerPhaseRef.current += dt * phaseSpeed;
      const phase = crawlerPhaseRef.current;

      const norm = getNormalizedSpiderPos(phase);
      const sx = FACE_BOX_X + norm.x * FACE_BOX_W;
      const sy = FACE_BOX_Y + norm.y * FACE_BOX_H;

      spiderCoreRef.current?.setAttribute("cx", sx.toFixed(1));
      spiderCoreRef.current?.setAttribute("cy", sy.toFixed(1));
      if (spiderRingRef.current) {
        spiderRingRef.current.setAttribute("cx", sx.toFixed(1));
        spiderRingRef.current.setAttribute("cy", sy.toFixed(1));
        const ringR = (isScanning ? 8.5 : 6.8) + Math.sin(phase * 5) * 1.4;
        spiderRingRef.current.setAttribute("r", ringR.toFixed(1));
      }

      // Compute proximity of all 26 landmarks to crawler head and attach 8 spider legs
      const distances: Array<{ idx: number; d: number }> = [];
      for (let i = 0; i < VIEWBOX_FACE_NODES.length; i++) {
        const pt = VIEWBOX_FACE_NODES[i];
        const d = Math.hypot(pt.cx - sx, pt.cy - sy);
        distances.push({ idx: i, d });

        const prox = Math.max(0, 1 - d / 115);
        const circleEl = nodeCircleRefs.current[i];
        if (circleEl) {
          const baseR = pt.anchor ? 2.7 : 1.9;
          circleEl.setAttribute("r", (baseR + prox * (isScanning ? 2.0 : 1.3)).toFixed(2));
          circleEl.setAttribute(
            "fill-opacity",
            ((isScanning ? 0.34 : 0.24) + prox * (isScanning ? 0.66 : 0.62)).toFixed(2)
          );
        }
      }

      distances.sort((a, b) => a.d - b.d);
      for (let legIdx = 0; legIdx < SPIDER_LEG_COUNT; legIdx++) {
        const pathEl = legPathRefs.current[legIdx];
        const target = distances[legIdx];
        if (!pathEl || !target) continue;
        const pt = VIEWBOX_FACE_NODES[target.idx];
        const { kx, ky } = getSpiderKneePoint(sx, sy, pt.cx, pt.cy, legIdx, 15);
        pathEl.setAttribute(
          "d",
          `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${kx.toFixed(1)} ${ky.toFixed(1)} L ${pt.cx.toFixed(1)} ${pt.cy.toFixed(1)}`
        );
        const legOpacity = Math.max(
          0.26,
          (1 - target.d / 145) * (isScanning ? 0.96 : 0.72)
        );
        pathEl.setAttribute("stroke-opacity", legOpacity.toFixed(2));
      }

      // Illuminate web mesh edges directly under the crawling spider
      for (let eIdx = 0; eIdx < FACE_MESH_EDGES.length; eIdx++) {
        const edgeEl = edgeLineRefs.current[eIdx];
        if (!edgeEl) continue;
        const [aIdx, bIdx] = FACE_MESH_EDGES[eIdx];
        const a = VIEWBOX_FACE_NODES[aIdx];
        const b = VIEWBOX_FACE_NODES[bIdx];
        const mx = (a.cx + b.cx) * 0.5;
        const my = (a.cy + b.cy) * 0.5;
        const midDist = Math.hypot(mx - sx, my - sy);
        const edgeProx = Math.max(0, 1 - midDist / 120);
        const baseOpacity = isScanning ? 0.16 : 0.1;
        const edgeOpacity = baseOpacity + edgeProx * (isScanning ? 0.72 : 0.48);
        edgeEl.setAttribute("stroke-opacity", edgeOpacity.toFixed(2));
        edgeEl.setAttribute("stroke-width", (0.75 + edgeProx * 0.95).toFixed(2));
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [spiderActive, isScanning]);

  return (
    <div className={`relative flex flex-col items-center overflow-hidden rounded-2xl bg-[#0D1117] border border-[#1E293B] p-2.5 ${className}`}>
      <canvas ref={canvasRef} className="hidden" />

      {/* Clean Unobstructed Biometric Viewport */}
      <div className="relative aspect-[4/3] w-full max-w-[640px] overflow-hidden rounded-xl bg-[#070A0F]">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`h-full w-full object-cover ${mirrored ? "-scale-x-100" : ""}`}
        />

        {/* Bounded Optical Scan Sweep & Lock Zone (matches SVG 164..476 x 78..402) */}
        <div className="pointer-events-none absolute left-[25.625%] right-[25.625%] top-[16.25%] bottom-[16.25%] overflow-hidden rounded-sm">
          {isScanning && (
            <div className="animate-biometric-sweep absolute inset-x-0 h-10 -translate-y-full">
              <div className="h-full w-full bg-gradient-to-b from-transparent via-indigo-400/15 to-indigo-300/30" />
              <div className="h-[1.5px] w-full bg-gradient-to-r from-indigo-300/35 via-white/90 to-indigo-300/35 shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
            </div>
          )}

          {!isScanning && isAutoWatching && (
            <div className="animate-biometric-watch absolute inset-x-2 h-6">
              <div className="h-full w-full bg-gradient-to-b from-transparent to-white/10" />
              <div className="h-px w-full bg-gradient-to-r from-transparent via-white/65 to-transparent" />
            </div>
          )}

          {captureSeq > 0 && (
            <div
              key={captureSeq}
              className="animate-capture-shutter absolute inset-0 border border-white/50 bg-white/15"
            />
          )}
        </div>

        {/* L-Shaped Corner Viewfinder & Crawling Spider-Web Face Mesh */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg className="h-full w-full" viewBox="0 0 640 480" fill="none">
            {/* Clean 4 L-Shaped Viewfinder Corners with subtle focus lock */}
            <g
              className="transition-transform duration-300 ease-out"
              style={{
                transformOrigin: "320px 240px",
                transform: isScanning ? "scale(0.978)" : "scale(1)",
              }}
            >
              <path
                d="M 164 114 L 164 78 L 200 78"
                stroke={bracketStroke}
                strokeWidth={isScanning ? "2.8" : "2.5"}
                strokeLinecap="square"
                className="transition-all duration-200"
              />
              <path
                d="M 440 78 L 476 78 L 476 114"
                stroke={bracketStroke}
                strokeWidth={isScanning ? "2.8" : "2.5"}
                strokeLinecap="square"
                className="transition-all duration-200"
              />
              <path
                d="M 164 366 L 164 402 L 200 402"
                stroke={bracketStroke}
                strokeWidth={isScanning ? "2.8" : "2.5"}
                strokeLinecap="square"
                className="transition-all duration-200"
              />
              <path
                d="M 440 402 L 476 402 L 476 366"
                stroke={bracketStroke}
                strokeWidth={isScanning ? "2.8" : "2.5"}
                strokeLinecap="square"
                className="transition-all duration-200"
              />

              {/* Midpoint alignment ticks while actively scanning */}
              {isScanning && (
                <g stroke="#A5B4FC" strokeWidth="1.5" strokeOpacity="0.65">
                  <line x1="312" y1="78" x2="328" y2="78" />
                  <line x1="312" y1="402" x2="328" y2="402" />
                  <line x1="164" y1="232" x2="164" y2="248" />
                  <line x1="476" y1="232" x2="476" y2="248" />
                </g>
              )}
            </g>

            {/* Full-Face Geodesic Spider-Web Mesh & Crawling 8-Leg Scanner */}
            {showWebMesh && (
              <g>
                {/* Interconnected facial mesh web segments */}
                {FACE_MESH_EDGES.map(([aIdx, bIdx], eIdx) => {
                  const a = VIEWBOX_FACE_NODES[aIdx];
                  const b = VIEWBOX_FACE_NODES[bIdx];
                  return (
                    <line
                      key={eIdx}
                      ref={(el) => {
                        edgeLineRefs.current[eIdx] = el;
                      }}
                      x1={a.cx}
                      y1={a.cy}
                      x2={b.cx}
                      y2={b.cy}
                      stroke={isScanning ? "#A5B4FC" : landmarkColor}
                      strokeWidth="0.9"
                      strokeOpacity={isMatched ? "0.45" : isError ? "0.24" : "0.18"}
                    />
                  );
                })}

                {/* Dynamic articulated spider leg filaments attached to 8 closest nodes */}
                {spiderActive &&
                  Array.from({ length: SPIDER_LEG_COUNT }).map((_, legIdx) => (
                    <path
                      key={legIdx}
                      ref={(el) => {
                        legPathRefs.current[legIdx] = el;
                      }}
                      d="M 320 240 L 320 240"
                      stroke={isScanning ? "#E0E7FF" : "#CBD5E1"}
                      strokeWidth={isScanning ? "1.35" : "1.1"}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeOpacity="0.7"
                      fill="none"
                    />
                  ))}

                {/* 26 Anatomical facial landmark dots */}
                {VIEWBOX_FACE_NODES.map((pt, idx) => (
                  <circle
                    key={idx}
                    ref={(el) => {
                      nodeCircleRefs.current[idx] = el;
                    }}
                    cx={pt.cx}
                    cy={pt.cy}
                    r={pt.anchor ? 2.7 : 2.0}
                    fill={landmarkColor}
                    fillOpacity={isMatched ? 0.95 : isError ? 0.45 : 0.65}
                  />
                ))}

                {/* Moving Optical Spider Sensor Core */}
                {spiderActive && (
                  <g>
                    <circle
                      ref={spiderRingRef}
                      cx="320"
                      cy="240"
                      r="7.5"
                      stroke={isScanning ? "#818CF8" : "#E2E8F0"}
                      strokeWidth="1.25"
                      strokeOpacity={isScanning ? "0.9" : "0.65"}
                      fill={isScanning ? "rgba(129, 140, 248, 0.14)" : "rgba(255, 255, 255, 0.08)"}
                    />
                    <circle
                      ref={spiderCoreRef}
                      cx="320"
                      cy="240"
                      r={isScanning ? "3.2" : "2.6"}
                      fill="#FFFFFF"
                    />
                  </g>
                )}
              </g>
            )}
          </svg>
        </div>

        {/* Minimal Top Corner Telemetry Pills */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 text-[11px] font-medium text-slate-200 backdrop-blur-sm border border-white/10 tabular-nums">
            <span className={`h-1.5 w-1.5 rounded-full ${streamActive ? "bg-emerald-400" : "bg-amber-400"}`} />
            <span>{streamActive ? "640x480 Live" : "Starting sensor"}</span>
          </div>

          <div
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm border transition-colors ${
              isScanning
                ? "border-indigo-400/40 bg-indigo-950/75 text-indigo-100"
                : effectiveScanState === "matched"
                ? "border-emerald-400/40 bg-emerald-950/70 text-emerald-100"
                : effectiveScanState === "error"
                ? "border-rose-400/40 bg-rose-950/70 text-rose-100"
                : "border-white/10 bg-black/55 text-slate-200"
            }`}
          >
            {effectiveScanState === "matched" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            ) : effectiveScanState === "error" ? (
              <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
            ) : isScanning || isAutoWatching ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-400" />
              </span>
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
            )}
            <span>
              {effectiveScanState === "matched"
                ? "Verified"
                : effectiveScanState === "error"
                ? "Check Alignment"
                : isScanning
                ? "Scanning Face"
                : isAutoWatching
                ? "Auto-Scanning"
                : "Liveness Ready"}
            </span>
          </div>
        </div>

        {/* Subtle Bottom Instruction Pill */}
        <div className="absolute bottom-3 inset-x-3 flex justify-center pointer-events-none">
          <div className="relative overflow-hidden rounded-md bg-black/65 px-3.5 py-1 text-xs font-medium text-slate-100 backdrop-blur-sm border border-white/10">
            <span>
              {isScanning
                ? "Scanning geometry and liveness..."
                : isAutoWatching
                ? "Watching frame · Auto-scan active"
                : guideText}
            </span>
            {isScanning && (
              <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-white/10">
                <div className="animate-scan-progress h-full w-1/2 bg-gradient-to-r from-transparent via-indigo-400 to-transparent" />
              </div>
            )}
          </div>
        </div>

        {/* Insecure Context Diagnostic Overlay (College LAN HTTPS Deployment) */}
        {insecureContextInfo ? (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0B0F17]/95 p-6 text-center text-white backdrop-blur-sm">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 mb-3 border border-rose-500/30">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <h4 className="text-sm font-semibold text-white mb-1">
              Camera Blocked: Insecure HTTP Context
            </h4>
            <p className="text-xs text-slate-400 max-w-sm mb-3.5 leading-relaxed">
              Browser security policies restrict optical camera sensors over plain HTTP on LAN IP addresses. Use HTTPS for kiosk and gate terminals.
            </p>

            <div className="w-full max-w-xs rounded-lg border border-slate-800 bg-slate-900/90 p-2.5 text-left font-mono text-[10px] space-y-1 mb-3.5 text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">Origin:</span>
                <span className="text-rose-400 font-medium truncate max-w-[170px]" title={insecureContextInfo.origin}>
                  {insecureContextInfo.origin}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Secure Context:</span>
                <span className="text-rose-400">false</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Required:</span>
                <span className="text-emerald-400 font-medium">https: (Port 443)</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2">
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
                className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry</span>
              </Button>
            </div>
          </div>
        ) : (
          errorMsg && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B0F17]/95 p-6 text-center text-white">
              <AlertCircle className="mb-3 h-10 w-10 text-rose-400" />
              <p className="mb-4 text-xs sm:text-sm text-slate-300 max-w-xs">{errorMsg}</p>
              <Button variant="primary" size="sm" onClick={startCamera}>
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry Camera</span>
              </Button>
            </div>
          )
        )}
      </div>

      {/* Camera Control Bar */}
      <div className="mt-2.5 flex w-full max-w-[640px] items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAutoScanActive(!autoScanActive)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
              autoScanActive
                ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
                : "border-slate-700/80 bg-slate-900/70 text-slate-400 hover:text-slate-200"
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            <span>{autoScanActive ? "Auto On" : "Auto Off"}</span>
          </button>

          {showMirrorToggle && (
            <button
              type="button"
              onClick={() => setMirrored((m) => !m)}
              title="Toggle mirror orientation"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                mirrored
                  ? "border-slate-700 bg-slate-800/80 text-slate-200"
                  : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200"
              }`}
            >
              <FlipHorizontal2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={captureFrame}
          disabled={!streamActive || isProcessing}
          isLoading={isProcessing}
          className="flex-1 max-w-[220px]"
        >
          <Camera className="h-4 w-4" />
          <span>{captureButtonText}</span>
        </Button>

        <button
          type="button"
          onClick={startCamera}
          title="Restart Video Stream"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
