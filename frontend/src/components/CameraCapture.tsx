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
  detectFaceInVideoFrame,
  backendBboxToViewBox,
} from "@/lib/faceMesh";

const DEFAULT_FACE_BOX = { x: 224, y: 120, w: 192, h: 240 };
const SPIDER_LEG_COUNT = 8;

interface FaceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CameraCaptureProps {
  onCapture: (base64Image: string) => void;
  isProcessing?: boolean;
  autoScanIntervalMs?: number;
  guideText?: string;
  captureButtonText?: string;
  className?: string;
  scanState?: "idle" | "scanning" | "matched" | "error";
  showMirrorToggle?: boolean;
  /** Optional backend-detected normalized bbox { x, y, w, h } in [0..1] */
  faceBbox?: FaceRect | null;
  /** Current face process stage label anchored right over the detected face */
  processStageLabel?: string | null;
  /** Optional detail line displayed inside the on-face process HUD */
  processStageSubtext?: string | null;
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
  faceBbox = null,
  processStageLabel = null,
  processStageSubtext = null,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [streamActive, setStreamActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [insecureContextInfo, setInsecureContextInfo] = useState<{
    origin: string;
    protocol: string;
    host: string;
  } | null>(null);
  const [autoScanActive, setAutoScanActive] = useState(autoScanIntervalMs > 0);
  const [mirrored, setMirrored] = useState(true);
  const [faceDetected, setFaceDetected] = useState(false);
  const [, setLastCapturePreview] = useState<string | null>(null);
  const [captureSeq, setCaptureSeq] = useState(0);
  const isMountedRef = useRef<boolean>(true);
  const nodeCircleRefs = useRef<(SVGCircleElement | null)[]>([]);
  const edgeLineRefs = useRef<(SVGLineElement | null)[]>([]);
  const legPathRefs = useRef<(SVGPathElement | null)[]>([]);
  const spiderRingRef = useRef<SVGCircleElement | null>(null);
  const spiderCoreRef = useRef<SVGCircleElement | null>(null);
  const bracketTLRef = useRef<SVGPathElement | null>(null);
  const bracketTRRef = useRef<SVGPathElement | null>(null);
  const bracketBLRef = useRef<SVGPathElement | null>(null);
  const bracketBRRef = useRef<SVGPathElement | null>(null);
  const tickTopRef = useRef<SVGLineElement | null>(null);
  const tickBottomRef = useRef<SVGLineElement | null>(null);
  const tickLeftRef = useRef<SVGLineElement | null>(null);
  const tickRightRef = useRef<SVGLineElement | null>(null);
  const scanBeamRef = useRef<SVGRectElement | null>(null);
  const scanLineRef = useRef<SVGLineElement | null>(null);
  const faceHudGroupRef = useRef<SVGGElement | null>(null);
  const faceHudTitleRef = useRef<SVGTextElement | null>(null);
  const faceHudSubRef = useRef<SVGTextElement | null>(null);
  const crawlerPhaseRef = useRef<number>(0);
  const targetBoxRef = useRef<FaceRect | null>(null);
  const renderBoxRef = useRef<FaceRect>({ ...DEFAULT_FACE_BOX });
  const faceDetectedRef = useRef<boolean>(false);
  const missedFramesRef = useRef<number>(0);

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
    if (!faceBbox) return;
    const video = videoRef.current;
    const mapped = backendBboxToViewBox(
      faceBbox,
      mirrored,
      video?.videoWidth || 640,
      video?.videoHeight || 480
    );
    const hadTarget = targetBoxRef.current !== null;
    targetBoxRef.current = { x: mapped.x, y: mapped.y, w: mapped.w, h: mapped.h };
    if (!hadTarget) {
      renderBoxRef.current = { ...targetBoxRef.current };
    }
    missedFramesRef.current = 0;
    faceDetectedRef.current = true;
    setFaceDetected(true);
  }, [faceBbox, mirrored]);

  useEffect(() => {
    if (!streamActive) {
      targetBoxRef.current = null;
      faceDetectedRef.current = false;
      setFaceDetected(false);
      return;
    }

    let cancelled = false;
    let running = false;

    const probe = async () => {
      if (cancelled || running || !videoRef.current || !scratchCanvasRef.current) return;
      running = true;
      try {
        const detected = await detectFaceInVideoFrame(
          videoRef.current,
          scratchCanvasRef.current,
          mirrored
        );
        if (cancelled) return;
        if (detected) {
          const hadTarget = targetBoxRef.current !== null;
          targetBoxRef.current = {
            x: detected.x,
            y: detected.y,
            w: detected.w,
            h: detected.h,
          };
          if (!hadTarget) {
            renderBoxRef.current = { ...targetBoxRef.current };
          }
          missedFramesRef.current = 0;
          if (!faceDetectedRef.current) {
            faceDetectedRef.current = true;
            setFaceDetected(true);
          }
        } else {
          missedFramesRef.current += 1;
          if (missedFramesRef.current >= 3 && faceDetectedRef.current && effectiveScanState === "idle") {
            targetBoxRef.current = null;
            faceDetectedRef.current = false;
            setFaceDetected(false);
          }
        }
      } finally {
        running = false;
      }
    };

    void probe();
    const timer = setInterval(() => {
      void probe();
    }, 85);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [streamActive, mirrored, effectiveScanState]);

  useEffect(() => {
    if (!autoScanActive || !streamActive || isProcessing) return;
    const interval = autoScanIntervalMs > 0 ? autoScanIntervalMs : 1500;

    const timer = setInterval(() => {
      if (faceDetectedRef.current) {
        captureFrame();
      }
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
      : "rgba(255, 255, 255, 0.90)";

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
  const hasTrackedFace = faceDetected || Boolean(faceBbox);
  const spiderActive = hasTrackedFace && (isScanning || isAutoWatching || streamActive);
  const showWebMesh = hasTrackedFace && (spiderActive || isMatched || isError);

  const stageTitleText =
    processStageLabel ||
    (isMatched
      ? "VERIFIED · IDENTITY CONFIRMED"
      : isError
      ? "HALTED · CHECK FACE ALIGNMENT"
      : isScanning
      ? "SCANNING · LIVENESS & EMBEDDING"
      : "FACE LOCKED · MESH TRACKING");

  // 60fps ref-driven smooth face localization, dynamic L-brackets, scanline, and spider crawler
  useEffect(() => {
    if (!hasTrackedFace) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let rafId = 0;
    let lastTs = performance.now();

    const applyFrameGeometry = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      const target = targetBoxRef.current ?? DEFAULT_FACE_BOX;
      const cur = renderBoxRef.current;
      const lerp = prefersReducedMotion ? 1 : Math.min(1, dt * 14);
      cur.x += (target.x - cur.x) * lerp;
      cur.y += (target.y - cur.y) * lerp;
      cur.w += (target.w - cur.w) * lerp;
      cur.h += (target.h - cur.h) * lerp;

      const bx = cur.x;
      const by = cur.y;
      const bw = cur.w;
      const bh = cur.h;

      // Update dynamic L-brackets around the detected face
      const pad = isScanning ? 12 : 18;
      const left = Math.max(8, bx - pad);
      const top = Math.max(8, by - pad);
      const right = Math.min(632, bx + bw + pad);
      const bottom = Math.min(472, by + bh + pad);
      const arm = Math.max(18, Math.min(34, (right - left) * 0.16));

      bracketTLRef.current?.setAttribute(
        "d",
        `M ${left.toFixed(1)} ${(top + arm).toFixed(1)} L ${left.toFixed(1)} ${top.toFixed(1)} L ${(left + arm).toFixed(1)} ${top.toFixed(1)}`
      );
      bracketTRRef.current?.setAttribute(
        "d",
        `M ${(right - arm).toFixed(1)} ${top.toFixed(1)} L ${right.toFixed(1)} ${top.toFixed(1)} L ${right.toFixed(1)} ${(top + arm).toFixed(1)}`
      );
      bracketBLRef.current?.setAttribute(
        "d",
        `M ${left.toFixed(1)} ${(bottom - arm).toFixed(1)} L ${left.toFixed(1)} ${bottom.toFixed(1)} L ${(left + arm).toFixed(1)} ${bottom.toFixed(1)}`
      );
      bracketBRRef.current?.setAttribute(
        "d",
        `M ${(right - arm).toFixed(1)} ${bottom.toFixed(1)} L ${right.toFixed(1)} ${bottom.toFixed(1)} L ${right.toFixed(1)} ${(bottom - arm).toFixed(1)}`
      );

      const midX = (left + right) * 0.5;
      const midY = (top + bottom) * 0.5;
      if (tickTopRef.current) {
        tickTopRef.current.setAttribute("x1", (midX - 8).toFixed(1));
        tickTopRef.current.setAttribute("x2", (midX + 8).toFixed(1));
        tickTopRef.current.setAttribute("y1", top.toFixed(1));
        tickTopRef.current.setAttribute("y2", top.toFixed(1));
      }
      if (tickBottomRef.current) {
        tickBottomRef.current.setAttribute("x1", (midX - 8).toFixed(1));
        tickBottomRef.current.setAttribute("x2", (midX + 8).toFixed(1));
        tickBottomRef.current.setAttribute("y1", bottom.toFixed(1));
        tickBottomRef.current.setAttribute("y2", bottom.toFixed(1));
      }
      if (tickLeftRef.current) {
        tickLeftRef.current.setAttribute("x1", left.toFixed(1));
        tickLeftRef.current.setAttribute("x2", left.toFixed(1));
        tickLeftRef.current.setAttribute("y1", (midY - 8).toFixed(1));
        tickLeftRef.current.setAttribute("y2", (midY + 8).toFixed(1));
      }
      if (tickRightRef.current) {
        tickRightRef.current.setAttribute("x1", right.toFixed(1));
        tickRightRef.current.setAttribute("x2", right.toFixed(1));
        tickRightRef.current.setAttribute("y1", (midY - 8).toFixed(1));
        tickRightRef.current.setAttribute("y2", (midY + 8).toFixed(1));
      }

      // Position floating process HUD pill directly over (or under) the detected face
      if (faceHudGroupRef.current) {
        const hudW = 246;
        const hudH = 34;
        const hudX = Math.max(10, Math.min(640 - hudW - 10, bx + bw * 0.5 - hudW * 0.5));
        const hudY = top >= hudH + 12 ? top - hudH - 8 : Math.min(470 - hudH, bottom + 8);
        faceHudGroupRef.current.setAttribute(
          "transform",
          `translate(${hudX.toFixed(1)}, ${hudY.toFixed(1)})`
        );
      }
      if (faceHudTitleRef.current) {
        faceHudTitleRef.current.textContent = stageTitleText;
      }
      if (faceHudSubRef.current) {
        faceHudSubRef.current.textContent =
          processStageSubtext ||
          `FACE LOCK (${Math.round(bx)}, ${Math.round(by)}) · ${Math.round(bw)}×${Math.round(bh)}px`;
      }

      // Optical scanline sweep strictly inside the detected face box
      if (scanBeamRef.current && scanLineRef.current) {
        const sweepFreq = isScanning ? 0.85 : 0.45;
        const sweepT = ((now / 1000) * sweepFreq) % 1;
        const beamY = by + sweepT * Math.max(20, bh - 4);
        const beamH = Math.min(28, bh * 0.16);
        scanBeamRef.current.setAttribute("x", bx.toFixed(1));
        scanBeamRef.current.setAttribute("y", Math.max(by, beamY - beamH).toFixed(1));
        scanBeamRef.current.setAttribute("width", bw.toFixed(1));
        scanBeamRef.current.setAttribute("height", beamH.toFixed(1));
        scanLineRef.current.setAttribute("x1", bx.toFixed(1));
        scanLineRef.current.setAttribute("x2", (bx + bw).toFixed(1));
        scanLineRef.current.setAttribute("y1", beamY.toFixed(1));
        scanLineRef.current.setAttribute("y2", beamY.toFixed(1));
      }

      // Advance spider phase and project 26 landmarks onto dynamic face rect
      const phaseSpeed = prefersReducedMotion ? 0 : isScanning ? 3.2 : 1.55;
      crawlerPhaseRef.current += dt * phaseSpeed;
      const phase = crawlerPhaseRef.current;

      const norm = getNormalizedSpiderPos(phase);
      const sx = bx + norm.x * bw;
      const sy = by + norm.y * bh;

      spiderCoreRef.current?.setAttribute("cx", sx.toFixed(1));
      spiderCoreRef.current?.setAttribute("cy", sy.toFixed(1));
      if (spiderRingRef.current) {
        spiderRingRef.current.setAttribute("cx", sx.toFixed(1));
        spiderRingRef.current.setAttribute("cy", sy.toFixed(1));
        const ringR = (isScanning ? 8.5 : 6.8) + Math.sin(phase * 5) * 1.4;
        spiderRingRef.current.setAttribute("r", ringR.toFixed(1));
      }

      const projectedNodes: Array<{ cx: number; cy: number; anchor: boolean }> = [];
      const distances: Array<{ idx: number; d: number }> = [];
      for (let i = 0; i < FACE_MESH_NODES.length; i++) {
        const rawPt = FACE_MESH_NODES[i];
        const cx = bx + rawPt.x * bw;
        const cy = by + rawPt.y * bh;
        const anchor = Boolean(rawPt.anchor);
        projectedNodes.push({ cx, cy, anchor });

        const d = Math.hypot(cx - sx, cy - sy);
        distances.push({ idx: i, d });

        const prox = Math.max(0, 1 - d / Math.max(95, bw * 0.58));
        const circleEl = nodeCircleRefs.current[i];
        if (circleEl) {
          circleEl.setAttribute("cx", cx.toFixed(1));
          circleEl.setAttribute("cy", cy.toFixed(1));
          const baseR = anchor ? 2.7 : 1.9;
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
        const targetNode = distances[legIdx];
        if (!pathEl || !targetNode) continue;
        const pt = projectedNodes[targetNode.idx];
        const { kx, ky } = getSpiderKneePoint(sx, sy, pt.cx, pt.cy, legIdx, 15);
        pathEl.setAttribute(
          "d",
          `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${kx.toFixed(1)} ${ky.toFixed(1)} L ${pt.cx.toFixed(1)} ${pt.cy.toFixed(1)}`
        );
        const legOpacity = Math.max(
          0.26,
          (1 - targetNode.d / Math.max(120, bw * 0.72)) * (isScanning ? 0.96 : 0.72)
        );
        pathEl.setAttribute("stroke-opacity", legOpacity.toFixed(2));
      }

      for (let eIdx = 0; eIdx < FACE_MESH_EDGES.length; eIdx++) {
        const edgeEl = edgeLineRefs.current[eIdx];
        if (!edgeEl) continue;
        const [aIdx, bIdx] = FACE_MESH_EDGES[eIdx];
        const a = projectedNodes[aIdx];
        const b = projectedNodes[bIdx];
        edgeEl.setAttribute("x1", a.cx.toFixed(1));
        edgeEl.setAttribute("y1", a.cy.toFixed(1));
        edgeEl.setAttribute("x2", b.cx.toFixed(1));
        edgeEl.setAttribute("y2", b.cy.toFixed(1));
        const mx = (a.cx + b.cx) * 0.5;
        const my = (a.cy + b.cy) * 0.5;
        const midDist = Math.hypot(mx - sx, my - sy);
        const edgeProx = Math.max(0, 1 - midDist / Math.max(100, bw * 0.62));
        const baseOpacity = isScanning ? 0.16 : 0.1;
        const edgeOpacity = baseOpacity + edgeProx * (isScanning ? 0.72 : 0.48);
        edgeEl.setAttribute("stroke-opacity", edgeOpacity.toFixed(2));
        edgeEl.setAttribute("stroke-width", (0.75 + edgeProx * 0.95).toFixed(2));
      }
    };

    if (prefersReducedMotion) {
      applyFrameGeometry(performance.now());
      return;
    }

    const step = (now: number) => {
      applyFrameGeometry(now);
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [hasTrackedFace, isScanning, stageTitleText, processStageSubtext]);

  return (
    <div className={`relative flex flex-col items-center overflow-hidden rounded-2xl bg-[#0D1117] border border-[#1E293B] p-2.5 ${className}`}>
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={scratchCanvasRef} className="hidden" />

      {/* Clean Unobstructed Biometric Viewport */}
      <div className="relative aspect-[4/3] w-full max-w-[640px] overflow-hidden rounded-xl bg-[#070A0F]">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`h-full w-full object-cover ${mirrored ? "-scale-x-100" : ""}`}
        />

        {captureSeq > 0 && (
          <div
            key={captureSeq}
            className="pointer-events-none animate-capture-shutter absolute inset-0 border border-white/40 bg-white/10"
          />
        )}

        {/* Dynamic Face-Locked L-Bracket Viewfinder, Process HUD & Spider Mesh */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg
            className="h-full w-full"
            viewBox="0 0 640 480"
            preserveAspectRatio="xMidYMid slice"
            fill="none"
          >
            <defs>
              <linearGradient id="cameraOnFaceScanGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isScanning ? "#818CF8" : "#94A3B8"} stopOpacity="0" />
                <stop offset="100%" stopColor={isScanning ? "#818CF8" : "#E2E8F0"} stopOpacity="0.28" />
              </linearGradient>
            </defs>

            {/* Subtle Standby Outer Perimeter Guides (only when no face is in frame) */}
            {!hasTrackedFace && (
              <g stroke="rgba(148, 163, 184, 0.35)" strokeWidth="1.75" strokeLinecap="square">
                <path d="M 32 64 L 32 32 L 64 32" />
                <path d="M 576 32 L 608 32 L 608 64" />
                <path d="M 32 416 L 32 448 L 64 448" />
                <path d="M 576 448 L 608 448 L 608 416" />
              </g>
            )}

            {/* Dynamic Face-Tracked Brackets, On-Face Scan Sweep, HUD & Spider Mesh */}
            {hasTrackedFace && (
              <g>
                {/* Optical Scanline Beam strictly bounded to detected face */}
                {(isScanning || isAutoWatching) && (
                  <g>
                    <rect
                      ref={scanBeamRef}
                      x={DEFAULT_FACE_BOX.x}
                      y={DEFAULT_FACE_BOX.y}
                      width={DEFAULT_FACE_BOX.w}
                      height={24}
                      fill="url(#cameraOnFaceScanGrad)"
                    />
                    <line
                      ref={scanLineRef}
                      x1={DEFAULT_FACE_BOX.x}
                      x2={DEFAULT_FACE_BOX.x + DEFAULT_FACE_BOX.w}
                      y1={DEFAULT_FACE_BOX.y}
                      y2={DEFAULT_FACE_BOX.y}
                      stroke={isScanning ? "#A5B4FC" : "#E2E8F0"}
                      strokeWidth={isScanning ? "1.8" : "1.1"}
                      strokeOpacity="0.9"
                    />
                  </g>
                )}

                {/* 4 Dynamic L-Shaped Brackets tightly hugging the user's actual face */}
                <g>
                  <path
                    ref={bracketTLRef}
                    d="M 206 130 L 206 102 L 234 102"
                    stroke={bracketStroke}
                    strokeWidth={isScanning ? "2.8" : "2.5"}
                    strokeLinecap="square"
                  />
                  <path
                    ref={bracketTRRef}
                    d="M 406 102 L 434 102 L 434 130"
                    stroke={bracketStroke}
                    strokeWidth={isScanning ? "2.8" : "2.5"}
                    strokeLinecap="square"
                  />
                  <path
                    ref={bracketBLRef}
                    d="M 206 350 L 206 378 L 234 378"
                    stroke={bracketStroke}
                    strokeWidth={isScanning ? "2.8" : "2.5"}
                    strokeLinecap="square"
                  />
                  <path
                    ref={bracketBRRef}
                    d="M 406 378 L 434 378 L 434 350"
                    stroke={bracketStroke}
                    strokeWidth={isScanning ? "2.8" : "2.5"}
                    strokeLinecap="square"
                  />

                  {isScanning && (
                    <g stroke="#A5B4FC" strokeWidth="1.5" strokeOpacity="0.7">
                      <line ref={tickTopRef} x1="312" y1="102" x2="328" y2="102" />
                      <line ref={tickBottomRef} x1="312" y1="378" x2="328" y2="378" />
                      <line ref={tickLeftRef} x1="206" y1="232" x2="206" y2="248" />
                      <line ref={tickRightRef} x1="434" y1="232" x2="434" y2="248" />
                    </g>
                  )}
                </g>

                {/* On-Face Floating Process Status HUD anchored directly to detected face */}
                <g ref={faceHudGroupRef} transform="translate(197, 56)">
                  <rect
                    x="0"
                    y="0"
                    width="246"
                    height="34"
                    rx="6"
                    fill="rgba(7, 10, 15, 0.84)"
                    stroke={bracketStroke}
                    strokeOpacity="0.55"
                    strokeWidth="1"
                  />
                  <circle
                    cx="13"
                    cy="12"
                    r="3.2"
                    fill={
                      isMatched
                        ? "#10B981"
                        : isError
                        ? "#F43F5E"
                        : isScanning
                        ? "#818CF8"
                        : "#38BDF8"
                    }
                  />
                  <text
                    ref={faceHudTitleRef}
                    x="22"
                    y="15"
                    fill="#F8FAFC"
                    fontSize="9.5"
                    fontWeight="700"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                  >
                    {stageTitleText}
                  </text>
                  <text
                    ref={faceHudSubRef}
                    x="10"
                    y="27.5"
                    fill="#94A3B8"
                    fontSize="8.5"
                    fontWeight="500"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                  >
                    {processStageSubtext || "BIOMETRIC COORDINATE LOCK ACTIVE"}
                  </text>
                </g>

                {/* Full-Face Geodesic Spider-Web Mesh & Crawling 8-Leg Scanner */}
                {showWebMesh && (
                  <g>
                    {FACE_MESH_EDGES.map(([aIdx, bIdx], eIdx) => {
                      const a = FACE_MESH_NODES[aIdx];
                      const b = FACE_MESH_NODES[bIdx];
                      return (
                        <line
                          key={eIdx}
                          ref={(el) => {
                            edgeLineRefs.current[eIdx] = el;
                          }}
                          x1={DEFAULT_FACE_BOX.x + a.x * DEFAULT_FACE_BOX.w}
                          y1={DEFAULT_FACE_BOX.y + a.y * DEFAULT_FACE_BOX.h}
                          x2={DEFAULT_FACE_BOX.x + b.x * DEFAULT_FACE_BOX.w}
                          y2={DEFAULT_FACE_BOX.y + b.y * DEFAULT_FACE_BOX.h}
                          stroke={isScanning ? "#A5B4FC" : landmarkColor}
                          strokeWidth="0.9"
                          strokeOpacity={isMatched ? "0.45" : isError ? "0.24" : "0.18"}
                        />
                      );
                    })}

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

                    {FACE_MESH_NODES.map((pt, idx) => (
                      <circle
                        key={idx}
                        ref={(el) => {
                          nodeCircleRefs.current[idx] = el;
                        }}
                        cx={DEFAULT_FACE_BOX.x + pt.x * DEFAULT_FACE_BOX.w}
                        cy={DEFAULT_FACE_BOX.y + pt.y * DEFAULT_FACE_BOX.h}
                        r={pt.anchor ? 2.7 : 2.0}
                        fill={landmarkColor}
                        fillOpacity={isMatched ? 0.95 : isError ? 0.45 : 0.65}
                      />
                    ))}

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
              </g>
            )}
          </svg>
        </div>

        {/* Minimal Top Corner Telemetry Pills */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 text-[11px] font-medium text-slate-200 backdrop-blur-sm border border-white/10 tabular-nums">
            <span className={`h-1.5 w-1.5 rounded-full ${streamActive ? "bg-emerald-400" : "bg-amber-400"}`} />
            <span>
              {streamActive
                ? hasTrackedFace
                  ? "Live · Face Tracked"
                  : "Live · Searching Frame"
                : "Starting sensor"}
            </span>
          </div>

          <div
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm border transition-colors ${
              isScanning
                ? "border-indigo-400/40 bg-indigo-950/75 text-indigo-100"
                : effectiveScanState === "matched"
                ? "border-emerald-400/40 bg-emerald-950/70 text-emerald-100"
                : effectiveScanState === "error"
                ? "border-rose-400/40 bg-rose-950/70 text-rose-100"
                : hasTrackedFace
                ? "border-sky-400/40 bg-sky-950/70 text-sky-100"
                : "border-white/10 bg-black/55 text-slate-200"
            }`}
          >
            {effectiveScanState === "matched" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            ) : effectiveScanState === "error" ? (
              <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
            ) : isScanning || (isAutoWatching && hasTrackedFace) ? (
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
                : hasTrackedFace
                ? isAutoWatching
                  ? "Face Locked · Auto"
                  : "Face Locked"
                : "Waiting for Face"}
            </span>
          </div>
        </div>

        {/* Subtle Bottom Instruction Pill */}
        <div className="absolute bottom-3 inset-x-3 flex justify-center pointer-events-none">
          <div className="relative overflow-hidden rounded-md bg-black/65 px-3.5 py-1 text-xs font-medium text-slate-100 backdrop-blur-sm border border-white/10">
            <span>
              {isScanning
                ? "Scanning geometry and liveness on detected face..."
                : !hasTrackedFace && streamActive
                ? "No face detected · Step into camera view anywhere"
                : isAutoWatching
                ? "Face localized · Auto-scan locked on subject"
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
