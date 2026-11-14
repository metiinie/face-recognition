import React from "react";
import Link from "next/link";
import { MonitorCheck, LayoutDashboard, Video } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center bg-[#F6F7F9] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-xs space-y-4">
        <div className="space-y-1">
          <span className="inline-flex items-center rounded-md bg-[#EEF2FF] px-2 py-0.5 font-mono text-[11px] font-medium text-[#4338CA]">
            404 · Route Not Found
          </span>
          <h1 className="text-lg font-semibold text-slate-900">
            This Faceo route does not exist
          </h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            Use one of the active terminals or management routes below. Make sure
            you are visiting Faceo on port 3000.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href="/kiosk"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#4F46E5] px-3.5 text-xs font-medium text-white hover:bg-[#4338CA] transition-colors"
          >
            <MonitorCheck className="h-3.5 w-3.5" />
            Kiosk Mode
          </Link>
          <Link
            href="/entrance"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-[#F6F7F9] transition-colors"
          >
            <Video className="h-3.5 w-3.5 text-slate-500" />
            Gate View
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
