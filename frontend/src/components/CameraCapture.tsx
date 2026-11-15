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
import { api } from "@/lib/api";
import {
  FACE_MESH_NODES,
  FACE_MESH_EDGES,
  getNormalizedSpiderPos,
  getSpiderKneePoint,
  detectFaceInVideoFrame,
  backendBboxToViewBox,
} from "@/lib/faceMesh";

const DEFAULT_FACE_BOX = { x: 252, y: 156, w: 136, h: 168 };
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
  const faceHudRectRef = useRef<SVGRectElement | null>(null);
  const faceHudTitleRef = useRef<SVGTextElement | null>(null);
  const crawlerPhaseRef = useRef<number>(0);
  const targetBoxRef = useRef<FaceRect | null>(null);
  const renderBoxRef = useRef<FaceRect>({ ...DEFAULT_FACE_BOX });
  const neuralAnchorRef = useRef<{
    box: FaceRect;
    clientCenterX: number | null;
    clientCenterY: number | null;
    ts: number;
  } | null>(null);
  const neuralMissRef = useRef<number>(0);
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
          } catch { }
        });
        return;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          if (isMountedRef.current) {
            videoRef.current?.play().catch(() => { });
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
        } catch { }
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

  const updateTargetBoxWithDeadband = useCallback((next: FaceRect) => {
    const prev = targetBoxRef.current;
    if (!prev) {
      targetBoxRef.current = next;
      renderBoxRef.current = { ...next };
      return;
    }
    const prevCx = prev.x + prev.w * 0.5;
    const prevCy = prev.y + prev.h * 0.5;
    const nextCx = next.x + next.w * 0.5;
    const nextCy = next.y + next.h * 0.5;
    const centerDist = Math.hypot(nextCx - prevCx, nextCy - prevCy);
    const sizeDelta = Math.abs(next.w - prev.w) + Math.abs(next.h - prev.h);
    if (centerDist < 11 && sizeDelta < 14) {
      return;
    }
    targetBoxRef.current = {
      x: prev.x * 0.6 + next.x * 0.4,
      y: prev.y * 0.6 + next.y * 0.4,
      w: prev.w * 0.6 + next.w * 0.4,
      h: prev.h * 0.6 + next.h * 0.4,
    };
  }, []);

  useEffect(() => {
    if (!faceBbox) return;
    const video = videoRef.current;
    const mapped = backendBboxToViewBox(
      faceBbox,
      mirrored,
      video?.videoWidth || 640,
      video?.videoHeight || 480
    );
    const rect = { x: mapped.x, y: mapped.y, w: mapped.w, h: mapped.h };
    updateTargetBoxWithDeadband(rect);
    neuralAnchorRef.current = {
      box: rect,
      clientCenterX: null,
      clientCenterY: null,
      ts: performance.now(),
    };
    missedFramesRef.current = 0;
    neuralMissRef.current = 0;
    faceDetectedRef.current = true;
    setFaceDetected(true);
  }, [faceBbox, mirrored, updateTargetBoxWithDeadband]);

  // Background ~350ms UltraFace ONNX detector for exact tight head bounding box regardless of background/skin tone
  useEffect(() => {
    if (!streamActive) {
      neuralAnchorRef.current = null;
      neuralMissRef.current = 0;
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const tinyCanvas = document.createElement("canvas");
    tinyCanvas.width = 240;
    tinyCanvas.height = 180;

    const runNeuralDetect = async () => {
      if (cancelled || inFlight || !videoRef.current) return;
      const video = videoRef.current;
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

      const tCtx = tinyCanvas.getContext("2d");
      if (!tCtx) return;

      // Slice-crop identically to CSS object-cover + SVG 640x480 viewBox
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const targetAspect = 640 / 480;
      const srcAspect = vw / vh;
      let sx = 0;
      let sy = 0;
      let sw = vw;
      let sh = vh;
      if (srcAspect > targetAspect) {
        sw = vh * targetAspect;
        sx = (vw - sw) * 0.5;
      } else if (srcAspect < targetAspect) {
        sh = vw / targetAspect;
        sy = (vh - sh) * 0.5;
      }
      tCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 240, 180);
      const tinyB64 = tinyCanvas.toDataURL("image/jpeg", 0.65);

      inFlight = true;
      try {
        const res = await api.detectFaceBbox(tinyB64);
        if (cancelled) return;
        if (res.detected && res.face_bbox) {
          // Since tinyCanvas is already slice-cropped to 4:3, map directly in 640x480 space
          const mapped = backendBboxToViewBox(res.face_bbox, mirrored, 640, 480);
          const rect = { x: mapped.x, y: mapped.y, w: mapped.w, h: mapped.h };
          neuralAnchorRef.current = {
            box: rect,
            clientCenterX: null,
            clientCenterY: null,
            ts: performance.now(),
          };
          updateTargetBoxWithDeadband(rect);
          neuralMissRef.current = 0;
          missedFramesRef.current = 0;
          if (!faceDetectedRef.current) {
            faceDetectedRef.current = true;
            setFaceDetected(true);
          }
        } else {
          neuralMissRef.current += 1;
          if (neuralMissRef.current >= 3) {
            neuralAnchorRef.current = null;
          }
        }
      } catch {
        // Ignore transient network hiccups; client probe continues smoothly
      } finally {
        inFlight = false;
      }
    };

    void runNeuralDetect();
    const timer = setInterval(() => {
      void runNeuralDetect();
    }, 360);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [streamActive, mirrored, updateTargetBoxWithDeadband]);

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

        const anchor = neuralAnchorRef.current;
        const anchorFresh = anchor !== null && performance.now() - anchor.ts < 1200;

        if (detected) {
          const detCenterX = detected.x + detected.w * 0.5;
          const detCenterY = detected.y + detected.h * 0.5;

          if (anchorFresh && anchor) {
            // Keep UltraFace tight dimensions and apply deadband-gated delta tracking
            if (anchor.clientCenterX === null || anchor.clientCenterY === null) {
              anchor.clientCenterX = detCenterX;
              anchor.clientCenterY = detCenterY;
              updateTargetBoxWithDeadband({ ...anchor.box });
            } else {
              const dx = Math.max(-24, Math.min(24, detCenterX - anchor.clientCenterX));
              const dy = Math.max(-18, Math.min(18, detCenterY - anchor.clientCenterY));
              updateTargetBoxWithDeadband({
                x: Math.max(8, Math.min(640 - anchor.box.w - 8, anchor.box.x + dx)),
                y: Math.max(8, Math.min(480 - anchor.box.h - 8, anchor.box.y + dy)),
                w: anchor.box.w,
                h: anchor.box.h,
              });
            }
          } else {
            updateTargetBoxWithDeadband({
              x: detected.x,
              y: detected.y,
              w: detected.w,
              h: detected.h,
            });
          }

          missedFramesRef.current = 0;
          if (!faceDetectedRef.current) {
            faceDetectedRef.current = true;
            setFaceDetected(true);
          }
        } else {
          if (anchorFresh && anchor) {
            // Neural detector still sees the face cleanly even if heuristic missed
            updateTargetBoxWithDeadband({ ...anchor.box });
            missedFramesRef.current = 0;
            return;
          }
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
  }, [streamActive, mirrored, effectiveScanState, updateTargetBoxWithDeadband]);

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

  const stageTitleText = (() => {
    const raw =
      processStageLabel ||
      (isMatched
        ? "VERIFIED · MATCH"
        : isError
          ? "ALIGN FACE"
          : isScanning
            ? "SCANNING FACE..."
            : "FACE LOCKED");
    return raw.length > 26 ? `${raw.slice(0, 25)}…` : raw;
  })();

  // 60fps ref-driven smooth face localization, tight L-brackets, inset scanline, and proportional spider crawler
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
      const lerp = prefersReducedMotion ? 1 : Math.min(1, dt * 6.5);
      cur.x += (target.x - cur.x) * lerp;
      cur.y += (target.y - cur.y) * lerp;
      cur.w += (target.w - cur.w) * lerp;
      cur.h += (target.h - cur.h) * lerp;

      const bx = cur.x;
      const by = cur.y;
      const bw = cur.w;
      const bh = cur.h;
      const scale = Math.max(0.75, Math.min(1.15, bw / 140));

      // Tight L-brackets hugging only the detected face contour
      const pad = isScanning ? 2 : 4;
      const left = Math.max(8, bx - pad);
      const top = Math.max(8, by - pad);
      const right = Math.min(632, bx + bw + pad);
      const bottom = Math.min(472, by + bh + pad);
      const arm = Math.max(15, Math.min(24, (right - left) * 0.16));

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
        tickTopRef.current.setAttribute("x1", (midX - 6).toFixed(1));
        tickTopRef.current.setAttribute("x2", (midX + 6).toFixed(1));
        tickTopRef.current.setAttribute("y1", top.toFixed(1));
        tickTopRef.current.setAttribute("y2", top.toFixed(1));
      }
      if (tickBottomRef.current) {
        tickBottomRef.current.setAttribute("x1", (midX - 6).toFixed(1));
        tickBottomRef.current.setAttribute("x2", (midX + 6).toFixed(1));
        tickBottomRef.current.setAttribute("y1", bottom.toFixed(1));
        tickBottomRef.current.setAttribute("y2", bottom.toFixed(1));
      }
      if (tickLeftRef.current) {
        tickLeftRef.current.setAttribute("x1", left.toFixed(1));
        tickLeftRef.current.setAttribute("x2", left.toFixed(1));
        tickLeftRef.current.setAttribute("y1", (midY - 6).toFixed(1));
        tickLeftRef.current.setAttribute("y2", (midY + 6).toFixed(1));
      }
      if (tickRightRef.current) {
        tickRightRef.current.setAttribute("x1", right.toFixed(1));
        tickRightRef.current.setAttribute("x2", right.toFixed(1));
        tickRightRef.current.setAttribute("y1", (midY - 6).toFixed(1));
        tickRightRef.current.setAttribute("y2", (midY + 6).toFixed(1));
      }

      // Bold floating process pill neatly anchored above forehead (never overlapping top/bottom viewport pills)
      const pillW = Math.min(212, Math.max(126, stageTitleText.length * 6.5 + 32));
      const pillH = 24;
      if (faceHudRectRef.current) {
        faceHudRectRef.current.setAttribute("width", pillW.toFixed(1));
      }
      if (faceHudGroupRef.current) {
        const hudX = Math.max(10, Math.min(640 - pillW - 10, bx + bw * 0.5 - pillW * 0.5));
        const hudY =
          top >= 72
            ? top - pillH - 7
            : Math.min(416 - pillH, bottom + 7);
        faceHudGroupRef.current.setAttribute(
          "transform",
          `translate(${hudX.toFixed(1)}, ${hudY.toFixed(1)})`
        );
      }
      if (faceHudTitleRef.current) {
        faceHudTitleRef.current.textContent = stageTitleText;
      }

      // Calm bidirectional optical scanline sweep cleanly confined within the face width
      if (scanBeamRef.current && scanLineRef.current) {
        const sweepRad = (now / 1000) * (isScanning ? 1.85 : 1.1);
        const sweepT = prefersReducedMotion ? 0.5 : 0.5 - 0.5 * Math.cos(sweepRad);
        const insetX = bx + bw * 0.08;
        const insetW = Math.max(24, bw * 0.84);
        const beamY = by + 4 + sweepT * Math.max(16, bh - 8);
        const beamH = Math.min(22, bh * 0.14);
        scanBeamRef.current.setAttribute("x", insetX.toFixed(1));
        scanBeamRef.current.setAttribute("y", Math.max(by + 2, beamY - beamH).toFixed(1));
        scanBeamRef.current.setAttribute("width", insetW.toFixed(1));
        scanBeamRef.current.setAttribute("height", beamH.toFixed(1));
        scanLineRef.current.setAttribute("x1", insetX.toFixed(1));
        scanLineRef.current.setAttribute("x2", (insetX + insetW).toFixed(1));
        scanLineRef.current.setAttribute("y1", beamY.toFixed(1));
        scanLineRef.current.setAttribute("y2", beamY.toFixed(1));
      }

      // Advance dynamic spider phase and project 26 bold landmarks tightly across the detected face
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
        const ringR = (isScanning ? 5.8 : 4.8) * scale + Math.sin(phase * 5) * 0.8;
        spiderRingRef.current.setAttribute("r", ringR.toFixed(1));
      }

      const proxRadius = Math.max(58, bw * 0.56);
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

        const prox = Math.max(0, 1 - d / proxRadius);
        const circleEl = nodeCircleRefs.current[i];
        if (circleEl) {
          circleEl.setAttribute("cx", cx.toFixed(1));
          circleEl.setAttribute("cy", cy.toFixed(1));
          const baseR = (anchor ? 2.4 : 1.75) * scale;
          circleEl.setAttribute("r", (baseR + prox * (isScanning ? 1.35 : 0.85) * scale).toFixed(2));
          circleEl.setAttribute(
            "fill-opacity",
            ((isScanning ? 0.54 : 0.44) + prox * (isScanning ? 0.41 : 0.36)).toFixed(2)
          );
        }
      }

      distances.sort((a, b) => a.d - b.d);
      const legReachMax = Math.max(72, bw * 0.72);
      const maxKneeBend = Math.min(8, bw * 0.055);
      for (let legIdx = 0; legIdx < SPIDER_LEG_COUNT; legIdx++) {
        const pathEl = legPathRefs.current[legIdx];
        const targetNode = distances[legIdx];
        if (!pathEl || !targetNode) continue;
        const pt = projectedNodes[targetNode.idx];
        const { kx, ky } = getSpiderKneePoint(sx, sy, pt.cx, pt.cy, legIdx, maxKneeBend);
        pathEl.setAttribute(
          "d",
          `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${kx.toFixed(1)} ${ky.toFixed(1)} L ${pt.cx.toFixed(1)} ${pt.cy.toFixed(1)}`
        );
        const legOpacity = Math.max(
          0.38,
          (1 - targetNode.d / legReachMax) * (isScanning ? 0.92 : 0.75)
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
        const edgeProx = Math.max(0, 1 - midDist / proxRadius);
        const baseOpacity = isScanning ? 0.22 : 0.16;
        const edgeOpacity = baseOpacity + edgeProx * (isScanning ? 0.52 : 0.38);
        edgeEl.setAttribute("stroke-opacity", edgeOpacity.toFixed(2));
        edgeEl.setAttribute("stroke-width", (0.85 + edgeProx * 0.75).toFixed(2));
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
  }, [hasTrackedFace, isScanning, stageTitleText]);

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
                <stop offset="100%" stopColor={isScanning ? "#818CF8" : "#E2E8F0"} stopOpacity="0.24" />
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

            {/* Dynamic Face-Tracked Brackets, On-Face Scan Sweep, Compact Pill & Spider Mesh */}
            {hasTrackedFace && (
              <g>
                {/* Inset Optical Scanline Beam strictly inside face width */}
                {(isScanning || isAutoWatching) && (
                  <g>
                    <rect
                      ref={scanBeamRef}
                      x={DEFAULT_FACE_BOX.x + 12}
                      y={DEFAULT_FACE_BOX.y}
                      width={DEFAULT_FACE_BOX.w - 24}
                      height={16}
                      fill="url(#cameraOnFaceScanGrad)"
                    />
                    <line
                      ref={scanLineRef}
                      x1={DEFAULT_FACE_BOX.x + 12}
                      x2={DEFAULT_FACE_BOX.x + DEFAULT_FACE_BOX.w - 12}
                      y1={DEFAULT_FACE_BOX.y}
                      y2={DEFAULT_FACE_BOX.y}
                      stroke={isScanning ? "#A5B4FC" : "#E2E8F0"}
                      strokeWidth={isScanning ? "2.0" : "1.4"}
                      strokeOpacity="0.92"
                    />
                  </g>
                )}

                {/* 4 Bold L-Shaped Brackets hugging only the user's face */}
                <g>
                  <path
                    ref={bracketTLRef}
                    d="M 248 172 L 248 152 L 268 152"
                    stroke={bracketStroke}
                    strokeWidth={isScanning ? "3.2" : "2.8"}
                    strokeLinecap="square"
                  />
                  <path
                    ref={bracketTRRef}
                    d="M 372 152 L 392 152 L 392 172"
                    stroke={bracketStroke}
                    strokeWidth={isScanning ? "3.2" : "2.8"}
                    strokeLinecap="square"
                  />
                  <path
                    ref={bracketBLRef}
                    d="M 248 308 L 248 328 L 268 328"
                    stroke={bracketStroke}
                    strokeWidth={isScanning ? "3.2" : "2.8"}
                    strokeLinecap="square"
                  />
                  <path
                    ref={bracketBRRef}
                    d="M 372 328 L 392 328 L 392 308"
                    stroke={bracketStroke}
                    strokeWidth={isScanning ? "3.2" : "2.8"}
                    strokeLinecap="square"
                  />

                  {isScanning && (
                    <g stroke="#A5B4FC" strokeWidth="2.0" strokeOpacity="0.85">
                      <line ref={tickTopRef} x1="314" y1="152" x2="326" y2="152" />
                      <line ref={tickBottomRef} x1="314" y1="328" x2="326" y2="328" />
                      <line ref={tickLeftRef} x1="248" y1="234" x2="248" y2="246" />
                      <line ref={tickRightRef} x1="392" y1="234" x2="392" y2="246" />
                    </g>
                  )}
                </g>

                {/* Bold Floating Single-Line Process Pill above forehead */}
                <g ref={faceHudGroupRef} transform="translate(238, 122)">
                  <rect
                    ref={faceHudRectRef}
                    x="0"
                    y="0"
                    width="164"
                    height="24"
                    rx="7"
                    fill="rgba(7, 10, 15, 0.92)"
                    stroke={bracketStroke}
                    strokeOpacity="0.85"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="3.4"
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
                    x="21"
                    y="15.5"
                    fill="#FFFFFF"
                    fontSize="10"
                    fontWeight="800"
                    letterSpacing="0.04em"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                  >
                    {stageTitleText}
                  </text>
                </g>

                {/* Bold Crisp Geodesic Spider-Web Mesh & Crawling 8-Leg Scanner */}
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
                          strokeWidth="0.95"
                          strokeOpacity={isMatched ? "0.52" : isError ? "0.28" : "0.22"}
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
                          strokeWidth={isScanning ? "1.35" : "1.15"}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeOpacity="0.78"
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
                        r={pt.anchor ? 2.4 : 1.75}
                        fill={landmarkColor}
                        fillOpacity={isMatched ? 0.95 : isError ? 0.52 : 0.72}
                      />
                    ))}

                    {spiderActive && (
                      <g>
                        <circle
                          ref={spiderRingRef}
                          cx="320"
                          cy="240"
                          r="5.4"
                          stroke={isScanning ? "#818CF8" : "#E2E8F0"}
                          strokeWidth="1.5"
                          strokeOpacity={isScanning ? "0.9" : "0.7"}
                          fill={isScanning ? "rgba(129, 140, 248, 0.18)" : "rgba(255, 255, 255, 0.1)"}
                        />
                        <circle
                          ref={spiderCoreRef}
                          cx="320"
                          cy="240"
                          r={isScanning ? "2.8" : "2.4"}
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
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm border transition-colors ${isScanning
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
              {processStageSubtext
                ? processStageSubtext
                : isScanning
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
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${autoScanActive
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
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${mirrored
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
