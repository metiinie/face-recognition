"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import { Camera, RefreshCw, AlertCircle, CheckCircle2, ShieldCheck, Zap } from "lucide-react";
import { Button } from "./ui/Button";

interface CameraCaptureProps {
  onCapture: (base64Image: string) => void;
  isProcessing?: boolean;
  autoScanIntervalMs?: number;
  guideText?: string;
  captureButtonText?: string;
  className?: string;
}

export function CameraCapture({
  onCapture,
  isProcessing = false,
  autoScanIntervalMs = 0,
  guideText = "Position your face inside the oval guide",
  captureButtonText = "Scan Face Now",
  className = "",
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [streamActive, setStreamActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [autoScanActive, setAutoScanActive] = useState(autoScanIntervalMs > 0);
  const [lastCapturePreview, setLastCapturePreview] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    setErrorMsg(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser MediaDevices API is not supported in this environment.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setStreamActive(true);
        };
      }
    } catch (err: any) {
      console.error("Camera access error:", err);
      setErrorMsg(
        err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access in your browser settings."
          : `Failed to initialize camera: ${err.message || "Unknown error"}`
      );
      setStreamActive(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
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

    // Draw current video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Export JPEG base64 data URL
    const b64 = canvas.toDataURL("image/jpeg", 0.92);
    setLastCapturePreview(b64);
    onCapture(b64);
  }, [streamActive, onCapture]);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  // Auto-scan timer if enabled
  useEffect(() => {
    if (!autoScanActive || !streamActive || isProcessing) return;
    const interval = autoScanIntervalMs > 0 ? autoScanIntervalMs : 1500;

    const timer = setInterval(() => {
      captureFrame();
    }, interval);

    return () => clearInterval(timer);
  }, [autoScanActive, streamActive, isProcessing, autoScanIntervalMs, captureFrame]);

  return (
    <div className={`relative flex flex-col items-center overflow-hidden rounded-2xl bg-slate-950 p-2 shadow-2xl ${className}`}>
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Video Viewport */}
      <div className="relative aspect-[4/3] w-full max-w-[640px] overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-cover -scale-x-100" // mirror display for user intuition
        />

        {/* Dynamic Oval Face Alignment Guide */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg className="h-full w-full" viewBox="0 0 640 480">
            <defs>
              <mask id="face-oval-mask">
                <rect width="640" height="480" fill="white" />
                <ellipse cx="320" cy="235" rx="135" ry="175" fill="black" />
              </mask>
            </defs>
            {/* Shaded backdrop outside the face oval */}
            <rect width="640" height="480" fill="rgba(15, 23, 42, 0.45)" mask="url(#face-oval-mask)" />

            {/* Glowing Oval Guide Ring */}
            <ellipse
              cx="320"
              cy="235"
              rx="135"
              ry="175"
              fill="none"
              stroke={isProcessing ? "#3b82f6" : "#10b981"}
              strokeWidth="3.5"
              strokeDasharray={isProcessing ? "12, 8" : "none"}
              className={isProcessing ? "animate-spin origin-center" : ""}
            />

            {/* Alignment Target Crosshairs / Corner Brackets */}
            <line x1="320" y1="50" x2="320" y2="70" stroke="#10b981" strokeWidth="2" />
            <line x1="320" y1="400" x2="320" y2="420" stroke="#10b981" strokeWidth="2" />
            <line x1="175" y1="235" x2="195" y2="235" stroke="#10b981" strokeWidth="2" />
            <line x1="445" y1="235" x2="465" y2="235" stroke="#10b981" strokeWidth="2" />
          </svg>

          {/* Active Anti-Spoofing Scanline */}
          <div className="animate-scanline pointer-events-none absolute h-1 w-3/4 rounded-full bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_#22d3ee]" />
        </div>

        {/* Top Floating Badge Bar */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-medium text-emerald-400 backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span>Live Camera (640x480)</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-medium text-slate-300 backdrop-blur-md">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
            <span>Anti-Spoof Active</span>
          </div>
        </div>

        {/* Bottom Guide Prompt */}
        <div className="absolute bottom-3 inset-x-3 text-center">
          <span className="inline-block rounded-full bg-slate-900/85 px-4 py-1.5 text-xs font-semibold text-slate-100 backdrop-blur-md shadow-lg border border-slate-700/50">
            {isProcessing ? "Analyzing biometrics & anti-spoofing..." : guideText}
          </span>
        </div>

        {/* Camera Permission / Error Overlay */}
        {errorMsg && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 p-6 text-center text-white backdrop-blur-sm">
            <AlertCircle className="mb-3 h-12 w-12 text-rose-500" />
            <p className="mb-4 text-sm text-slate-300">{errorMsg}</p>
            <Button variant="primary" size="sm" onClick={startCamera}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry Camera
            </Button>
          </div>
        )}
      </div>

      {/* Camera Control Action Bar */}
      <div className="mt-3 flex w-full max-w-[640px] items-center justify-between gap-3 px-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAutoScanActive(!autoScanActive)}
          className={`text-xs ${autoScanActive ? "border-blue-500 text-blue-400" : "text-slate-400"}`}
        >
          <Zap className="mr-1.5 h-3.5 w-3.5" />
          {autoScanActive ? "Auto-Scan On" : "Auto-Scan Off"}
        </Button>

        <Button
          variant="primary"
          size="lg"
          onClick={captureFrame}
          disabled={!streamActive || isProcessing}
          isLoading={isProcessing}
          className="flex-1 max-w-xs shadow-lg shadow-blue-600/30 font-semibold"
        >
          <Camera className="mr-2 h-5 w-5" />
          {captureButtonText}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={startCamera}
          className="text-xs text-slate-400 hover:text-white"
          title="Restart Video Stream"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

