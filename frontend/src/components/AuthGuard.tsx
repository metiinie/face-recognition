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
        <div className="rounded-2xl bg-rose-50 p-6 border border-rose-200 text-rose-800 max-w-md space-y-3 shadow-sm">
          <ShieldAlert className="h-10 w-10 text-rose-600 mx-auto" />
          <h3 className="text-base font-bold text-rose-950">Access Restricted</h3>
          <p className="text-xs text-rose-700">
            Your user account does not have sufficient role privileges to access this administrative portal.
          </p>
          <a
            href="/dashboard"
            className="inline-block rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-rose-700 transition-colors"
          >
            Return to Dashboard
          </a>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-3">
        <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
        <p className="text-xs text-slate-500 font-medium">Verifying authorization session...</p>
      </div>
    );
  }

  return <>{children}</>;
}

