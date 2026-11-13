"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getStoredToken, getStoredUser, handleUnauthorized, UserProfile } from "@/lib/api";
import { RefreshCw, ShieldAlert } from "lucide-react";

interface AuthGuardProps {
  children: React.ReactNode;
  allowedRoles?: Array<"SYSTEM_ADMIN" | "HR_OFFICER" | "DEPT_HEAD" | "KIOSK_OPERATOR">;
}

export function AuthGuard({ children, allowedRoles }: AuthGuardProps) {
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState<boolean>(false);
  const [roleForbidden, setRoleForbidden] = useState<boolean>(false);

  useEffect(() => {
    const token = getStoredToken();
    const user = getStoredUser();

    if (!token || !user) {
      handleUnauthorized(pathname);
      return;
    }

    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      setRoleForbidden(true);
      return;
    }

    setAuthorized(true);
  }, [pathname, allowedRoles]);

  if (roleForbidden) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
        <div className="rounded-xl bg-white p-6 border border-rose-200/80 text-slate-900 max-w-md space-y-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 border border-rose-200/70">
            <ShieldAlert className="h-5 w-5 text-rose-600" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900">Access Restricted</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Your account does not have sufficient role privileges to open this workspace view.
          </p>
          <a
            href="/dashboard"
            className="inline-flex h-8 items-center justify-center rounded-lg bg-[#0F172A] px-3.5 text-xs font-medium text-white hover:bg-[#1E293B] transition-colors"
          >
            Return to Dashboard
          </a>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-2.5">
        <RefreshCw className="h-5 w-5 animate-spin text-[#4F46E5]" />
        <p className="text-xs text-slate-500 font-medium">Verifying session access...</p>
      </div>
    );
  }

  return <>{children}</>;
}

