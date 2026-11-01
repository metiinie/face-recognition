"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Camera,
  LayoutDashboard,
  Users,
  LineChart,
  ShieldAlert,
  Clock,
  Building2,
  Lock,
  FileText,
  CalendarClock,
} from "lucide-react";
import { Badge } from "./ui/Badge";
import { getStoredUser, removeStoredToken, UserProfile } from "@/lib/api";

export function Navbar() {
  const pathname = usePathname();
  const [currentTime, setCurrentTime] = useState<string>("");
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    setUser(getStoredUser());

    const updateClock = () => {
      const now = new Date();
      // Format in East Africa Time (UTC+3)
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Addis_Ababa",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(now);
      setCurrentTime(formatted);
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { name: "Kiosk Station", href: "/kiosk", icon: Camera },
    { name: "HR Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Employees", href: "/employees", icon: Users },
    { name: "Reports & CSV", href: "/reports", icon: FileText },
    { name: "Schedules & Stations", href: "/schedules", icon: CalendarClock },
    { name: "Biometrics Lab", href: "/biometrics", icon: LineChart },
    { name: "Audit & Review", href: "/audit", icon: ShieldAlert },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6">
        {/* Brand & Institution Info */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 dark:text-white text-sm sm:text-base tracking-tight">
                Ethio-Italy Polytechnic College
              </span>
              <Badge variant="brand" className="hidden sm:inline-flex text-[10px] py-0 px-1.5">
                Dire Dawa • V1
              </Badge>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Biometric Attendance Management System
            </p>
          </div>
        </div>

        {/* Center Navigation Links */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right Status & EAT Time Bar */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 font-mono">
            <Clock className="h-3.5 w-3.5 text-blue-500" />
            <span>{currentTime || "EAT (UTC+3)"}</span>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="success" className="text-[10px]">
              Station #1 Online
            </Badge>

            {user ? (
              <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <span className="font-semibold">{user.username}</span>
                <button
                  onClick={() => {
                    removeStoredToken();
                    setUser(null);
                    window.location.reload();
                  }}
                  className="text-[10px] text-rose-500 underline ml-1"
                >
                  Logout
                </button>
              </div>
            ) : (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600"
              >
                <Lock className="h-3 w-3" />
                <span>Login</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Sub-Navigation Bar */}
      <div className="flex lg:hidden overflow-x-auto border-t border-slate-100 px-3 py-1.5 dark:border-slate-800 gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300"
              }`}
            >
              <Icon className="h-3 w-3" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </div>
    </header>
  );
}
