"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, MonitorCheck, LayoutDashboard } from "lucide-react";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RouteError({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error("Faceo route error:", error);
  }, [error]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center bg-[#F6F7F9] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-xs space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 border border-rose-200">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-900">
              Something interrupted this view
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              A client runtime exception occurred instead of crashing silently.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[#EAECEF] bg-[#F8FAFC] p-3 text-xs font-mono text-slate-700 break-words">
          {error?.message || "Unexpected rendering error"}
          {error?.digest ? (
            <div className="mt-1 text-[10px] text-slate-400">
              digest: {error.digest}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#4F46E5] px-3.5 text-xs font-medium text-white hover:bg-[#4338CA] transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Try again
          </button>

          <Link
            href="/kiosk"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-[#F6F7F9] transition-colors"
          >
            <MonitorCheck className="h-3.5 w-3.5 text-slate-500" />
            Kiosk Mode
          </Link>

          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-[#F6F7F9] transition-colors"
          >
            <LayoutDashboard className="h-3.5 w-3.5 text-slate-500" />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
