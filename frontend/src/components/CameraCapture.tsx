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
  const isMountedRef = useRef<boolean>(true);

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

  const showLandmarks = effectiveScanState === "scanning" || effectiveScanState === "matched";

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

        {/* L-Shaped Corner Viewfinder & Optional Minimal Landmark Points */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg className="h-full w-full" viewBox="0 0 640 480" fill="none">
            {/* Clean 4 L-Shaped Viewfinder Corners */}
            <path
              d="M 164 114 L 164 78 L 200 78"
              stroke={bracketStroke}
              strokeWidth="2.5"
              strokeLinecap="square"
              className="transition-colors duration-200"
            />
            <path
              d="M 440 78 L 476 78 L 476 114"
              stroke={bracketStroke}
              strokeWidth="2.5"
              strokeLinecap="square"
              className="transition-colors duration-200"
            />
            <path
              d="M 164 366 L 164 402 L 200 402"
              stroke={bracketStroke}
              strokeWidth="2.5"
              strokeLinecap="square"
              className="transition-colors duration-200"
            />
            <path
              d="M 440 402 L 476 402 L 476 366"
              stroke={bracketStroke}
              strokeWidth="2.5"
              strokeLinecap="square"
              className="transition-colors duration-200"
            />

            {/* Minimal Facial Geometry Reference Nodes during active verification */}
            {showLandmarks && (
              <g opacity={effectiveScanState === "matched" ? 0.95 : 0.85}>
                {/* Subtle contour polyline connecting lower jawline */}
                <polyline
                  points="248,266 264,306 290,334 320,342 350,334 376,306 392,266"
                  stroke={landmarkColor}
                  strokeWidth="1"
                  strokeOpacity="0.28"
                  strokeDasharray="3 3"
                  fill="none"
                />
                {/* Eye corners */}
                <circle cx="268" cy="206" r="2.6" fill={landmarkColor} />
                <circle cx="300" cy="208" r="2.2" fill={landmarkColor} />
                <circle cx="340" cy="208" r="2.2" fill={landmarkColor} />
                <circle cx="372" cy="206" r="2.6" fill={landmarkColor} />
                {/* Nose tip */}
                <circle cx="320" cy="250" r="2.5" fill={landmarkColor} />
                {/* Mouth corners */}
                <circle cx="294" cy="286" r="2.2" fill={landmarkColor} />
                <circle cx="346" cy="286" r="2.2" fill={landmarkColor} />
                {/* Jawline & chin contour nodes */}
                <circle cx="248" cy="266" r="2" fill={landmarkColor} fillOpacity="0.8" />
                <circle cx="264" cy="306" r="2" fill={landmarkColor} fillOpacity="0.8" />
                <circle cx="290" cy="334" r="2" fill={landmarkColor} fillOpacity="0.8" />
                <circle cx="320" cy="342" r="2.4" fill={landmarkColor} />
                <circle cx="350" cy="334" r="2" fill={landmarkColor} fillOpacity="0.8" />
                <circle cx="376" cy="306" r="2" fill={landmarkColor} fillOpacity="0.8" />
                <circle cx="392" cy="266" r="2" fill={landmarkColor} fillOpacity="0.8" />
              </g>
            )}
          </svg>

          {/* Subtle hairline pass only while actively scanning */}
          {effectiveScanState === "scanning" && (
            <div className="animate-biometric-sweep pointer-events-none absolute left-[26%] right-[26%] h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" />
          )}
        </div>

        {/* Minimal Top Corner Telemetry Pills */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 text-[11px] font-medium text-slate-200 backdrop-blur-sm border border-white/10 tabular-nums">
            <span className={`h-1.5 w-1.5 rounded-full ${streamActive ? "bg-emerald-400" : "bg-amber-400"}`} />
            <span>{streamActive ? "640x480 Live" : "Starting sensor"}</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-md bg-black/55 px-2.5 py-1 text-[11px] font-medium text-slate-200 backdrop-blur-sm border border-white/10">
            {effectiveScanState === "matched" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            ) : effectiveScanState === "error" ? (
              <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
            )}
            <span>
              {effectiveScanState === "matched"
                ? "Verified"
                : effectiveScanState === "error"
                ? "Check Alignment"
                : effectiveScanState === "scanning"
                ? "Analyzing"
                : "Liveness Ready"}
            </span>
          </div>
        </div>

        {/* Subtle Bottom Instruction Pill */}
        <div className="absolute bottom-3 inset-x-3 text-center pointer-events-none">
          <span className="inline-block rounded-md bg-black/60 px-3 py-1 text-xs font-medium text-slate-100 backdrop-blur-sm border border-white/10">
            {effectiveScanState === "scanning" ? "Capturing geometry and liveness..." : guideText}
          </span>
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
