"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Camera,
  Radio,
  LayoutDashboard,
  Users,
  FileText,
  CalendarClock,
  ShieldAlert,
  LineChart,
  Database,
  Clock,
  Lock,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  X,
  ArrowLeft,
} from "lucide-react";
import { getStoredUser, removeStoredToken, UserProfile } from "@/lib/api";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const TERMINAL_ITEMS: NavItem[] = [
  { name: "Kiosk Mode", href: "/kiosk", icon: Camera },
  { name: "Gate Monitor", href: "/entrance", icon: Radio },
];

const OPERATIONS_ITEMS: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Employees", href: "/employees", icon: Users },
  { name: "Reports & CSV", href: "/reports", icon: FileText },
  { name: "Schedules", href: "/schedules", icon: CalendarClock },
];

const ADMIN_ITEMS: NavItem[] = [
  { name: "Audit & Review", href: "/audit", icon: ShieldAlert },
  { name: "Biometrics Lab", href: "/biometrics", icon: LineChart },
  { name: "Backups & DR", href: "/backups", icon: Database, adminOnly: true },
];

function FaceoBrandMark({ className = "h-7 w-7", dark = false }: { className?: string; dark?: boolean }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-lg ${
        dark
          ? "bg-[#4F46E5] text-white"
          : "bg-[#4F46E5] text-white shadow-[0_1px_2px_rgba(79,70,229,0.22)]"
      } ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.1">
        <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" strokeLinecap="round" />
        <circle cx="9.5" cy="10" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="10" r="1" fill="currentColor" stroke="none" />
        <path d="M9.5 14.5c1.3 1.1 3.7 1.1 5 0" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function getEthiopianClockDisplay(now: Date): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Addis_Ababa",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((p) => p.type === "hour")?.value;
    const minutePart = parts.find((p) => p.type === "minute")?.value;
    const h = parseInt(hourPart || "0", 10);
    const m = parseInt(minutePart || "0", 10);

    let ethHour: number;
    let cycleAmharic: string;

    if (h >= 6 && h < 18) {
      ethHour = h - 6;
      if (ethHour === 0) ethHour = 12;
      cycleAmharic = "ቀን";
    } else {
      ethHour = h >= 18 ? h - 18 : h + 6;
      if (ethHour === 0) ethHour = 12;
      cycleAmharic = "ሌሊት";
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    return `${cycleAmharic} ${pad(ethHour)}:${pad(m)}`;
  } catch {
    return "";
  }
}

function formatRoleLabel(role?: UserProfile["role"]): string {
  switch (role) {
    case "SYSTEM_ADMIN":
      return "Admin";
    case "HR_OFFICER":
      return "HR Officer";
    case "DEPT_HEAD":
      return "Dept Head";
    case "KIOSK_OPERATOR":
      return "Operator";
    default:
      return "";
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [currentTime, setCurrentTime] = useState<string>("");
  const [ethiopianTime, setEthiopianTime] = useState<string>("");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [sidebarCompact, setSidebarCompact] = useState<boolean>(false);

  const isTerminalRoute = pathname === "/kiosk" || pathname === "/entrance";
  const isEntranceRoute = pathname === "/entrance";
  const isAuthRoute = pathname === "/login";
  const isWorkspaceRoute = !isTerminalRoute && !isAuthRoute;

  useEffect(() => {
    setUser(getStoredUser());
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Addis_Ababa",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now);
      setCurrentTime(formatted);
      setEthiopianTime(getEthiopianClockDisplay(now));
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    removeStoredToken();
    setUser(null);
    window.location.href = "/login";
  };

  const canSeeItem = (item: NavItem) => {
    if (!item.adminOnly) return true;
    return !user || user.role === "SYSTEM_ADMIN";
  };

  const renderNavSection = (
    title: string,
    items: NavItem[],
    compact: boolean,
    darkTheme = false
  ) => (
    <div>
      {!compact && (
        <p
          className={`px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
            darkTheme ? "text-slate-500" : "text-slate-400"
          }`}
        >
          {title}
        </p>
      )}
      <div className="space-y-0.5">
        {items.filter(canSeeItem).map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const activeCls = darkTheme
            ? "bg-indigo-500/15 text-indigo-300 font-medium border border-indigo-500/25"
            : "bg-[#EEF2FF] text-[#4338CA] font-medium";
          const idleCls = darkTheme
            ? "text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
            : "text-slate-600 hover:bg-slate-100/75 hover:text-slate-900";
          const iconActiveCls = darkTheme ? "text-indigo-400" : "text-[#4F46E5]";
          const iconIdleCls = darkTheme
            ? "text-slate-500 group-hover:text-slate-300"
            : "text-slate-400 group-hover:text-slate-600";

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              title={compact ? item.name : undefined}
              className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                active ? activeCls : idleCls
              } ${compact ? "justify-center" : ""}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${active ? iconActiveCls : iconIdleCls}`} />
              {!compact && <span className="truncate">{item.name}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );

  const renderSidebarContent = (compact: boolean, darkTheme = false) => (
    <div className="flex flex-1 flex-col justify-between overflow-y-auto px-3 py-4 gap-6">
      <div className="space-y-5">
        {renderNavSection("Operations", OPERATIONS_ITEMS, compact, darkTheme)}
        {renderNavSection("Administration", ADMIN_ITEMS, compact, darkTheme)}
        {renderNavSection("Terminals", TERMINAL_ITEMS, compact, darkTheme)}
      </div>

      {/* Bottom Profile Card */}
      <div className={`pt-3 border-t ${darkTheme ? "border-[#1E293B]" : "border-[#EAECEF]"}`}>
        {compact ? (
          user ? (
            <button
              type="button"
              onClick={handleLogout}
              title={`Sign out (${user.username})`}
              className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-semibold transition-colors ${
                darkTheme
                  ? "border-slate-700 bg-slate-800 text-slate-200 hover:border-rose-500/40 hover:text-rose-400"
                  : "border-[#E5E7EB] bg-[#FAFBFD] text-slate-700 hover:bg-rose-50 hover:text-rose-600"
              }`}
            >
              {user.username.slice(0, 2).toUpperCase()}
            </button>
          ) : (
            <Link
              href="/login"
              title="Staff Portal Sign In"
              className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] text-slate-600 hover:text-[#4F46E5]"
            >
              <Lock className="h-3.5 w-3.5" />
            </Link>
          )
        ) : user ? (
          <div
            className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 ${
              darkTheme
                ? "border-[#1E293B] bg-[#0B0F17]"
                : "border-[#EAECEF] bg-[#FAFBFD]"
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold uppercase ${
                  darkTheme
                    ? "bg-indigo-500/20 text-indigo-300"
                    : "bg-[#EEF2FF] text-[#4338CA]"
                }`}
              >
                {user.username.slice(0, 2)}
              </div>
              <div className="min-w-0">
                <p
                  className={`text-xs font-medium truncate ${
                    darkTheme ? "text-slate-200" : "text-slate-900"
                  }`}
                >
                  {user.username}
                </p>
                <p className="text-[11px] text-slate-500 truncate">{formatRoleLabel(user.role)}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              className={`rounded-md p-1.5 transition-colors ${
                darkTheme
                  ? "text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
                  : "text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              }`}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#FAFBFD] px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <Lock className="h-3.5 w-3.5 text-[#4F46E5]" />
            <span>Staff Sign In</span>
          </Link>
        )}
      </div>
    </div>
  );

  // Auth route layout (/login)
  if (isAuthRoute) {
    return (
      <div className="min-h-screen flex flex-col bg-[#F6F7F9] text-slate-900">
        <header className="h-[52px] border-b border-[#EAECEF] bg-white">
          <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6">
            <Link href="/kiosk" className="flex items-center gap-2.5">
              <FaceoBrandMark />
              <div className="leading-none">
                <span className="font-semibold text-slate-900 text-sm tracking-tight">Faceo</span>
                <span className="ml-2 hidden sm:inline text-xs text-slate-400">EIPC Dire Dawa</span>
              </div>
            </Link>
            <Link
              href="/kiosk"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Kiosk Terminal</span>
            </Link>
          </div>
        </header>
        <main className="flex-1 flex flex-col justify-center px-4 py-6 sm:px-6">{children}</main>
      </div>
    );
  }

  // Dark Obsidian Shell for Continuous Gate (/entrance) or Light Shell for Workspace / Kiosk
  const darkShell = isEntranceRoute;

  return (
    <div
      className={`min-h-screen flex ${
        darkShell ? "bg-[#0B0F17] text-slate-100" : "bg-[#F6F7F9] text-slate-900"
      }`}
    >
      {/* Persistent Left Rail on Workspace Routes (Desktop lg+) */}
      {isWorkspaceRoute && (
        <aside
          className={`hidden lg:flex flex-col shrink-0 border-r border-[#EAECEF] bg-white transition-all duration-200 ${
            sidebarCompact ? "w-[68px]" : "w-60"
          }`}
        >
          {/* Sidebar Top Brand Header */}
          <div
            className={`flex h-14 items-center border-b border-[#EAECEF] px-3.5 ${
              sidebarCompact ? "justify-center" : "justify-between"
            }`}
          >
            <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0">
              <FaceoBrandMark />
              {!sidebarCompact && (
                <div className="min-w-0 leading-tight">
                  <p className="text-[14px] font-semibold tracking-tight text-slate-900">Faceo</p>
                  <p className="text-[10.5px] text-slate-400 truncate">EIPC · Dire Dawa</p>
                </div>
              )}
            </Link>
            {!sidebarCompact && (
              <button
                type="button"
                onClick={() => setSidebarCompact(true)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>

          {sidebarCompact && (
            <button
              type="button"
              onClick={() => setSidebarCompact(false)}
              className="mx-auto mt-2.5 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}

          {renderSidebarContent(sidebarCompact, false)}
        </aside>
      )}

      {/* Slide-Over Sidebar Drawer (Terminal routes + Mobile/Tablet workspace) */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className={`fixed inset-0 backdrop-blur-[2px] transition-opacity ${
              darkShell ? "bg-black/65" : "bg-slate-900/25"
            }`}
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            className={`relative z-10 flex w-64 max-w-[85vw] flex-col shadow-xl border-r ${
              darkShell
                ? "bg-[#121826] border-[#1E293B] text-slate-100"
                : "bg-white border-[#EAECEF] text-slate-900"
            }`}
          >
            <div
              className={`flex h-14 items-center justify-between border-b px-4 ${
                darkShell ? "border-[#1E293B]" : "border-[#EAECEF]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <FaceoBrandMark dark={darkShell} />
                <div>
                  <p className={`text-sm font-semibold leading-none ${darkShell ? "text-white" : "text-slate-900"}`}>
                    Faceo
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">EIPC · Dire Dawa</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className={`rounded-md p-1.5 transition-colors ${
                  darkShell
                    ? "text-slate-400 hover:bg-slate-800 hover:text-white"
                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                }`}
                aria-label="Close navigation drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {renderSidebarContent(false, darkShell)}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Global Slim Top Bar */}
        <header
          className={`sticky top-0 z-40 h-[52px] border-b ${
            darkShell
              ? "border-[#1E293B] bg-[#0B0F17]/95 backdrop-blur-sm"
              : "border-[#EAECEF] bg-white/95 backdrop-blur-sm"
          }`}
        >
          <div className="flex h-full items-center justify-between px-4 sm:px-6 gap-3">
            {/* Left: Menu trigger on mobile/terminals + Brand on terminals */}
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                  isWorkspaceRoute ? "lg:hidden" : ""
                } ${
                  darkShell
                    ? "border-[#1E293B] bg-[#121826] text-slate-300 hover:bg-slate-800 hover:text-white"
                    : "border-[#E5E7EB] bg-white text-slate-700 hover:bg-slate-50"
                }`}
                aria-label="Open navigation sidebar"
              >
                <PanelLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Menu</span>
              </button>

              {isTerminalRoute && (
                <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
                  <FaceoBrandMark className="h-7 w-7" dark={darkShell} />
                  <span
                    className={`hidden sm:inline text-sm font-semibold tracking-tight ${
                      darkShell ? "text-white" : "text-slate-900"
                    }`}
                  >
                    Faceo
                  </span>
                </Link>
              )}

              {isWorkspaceRoute && (
                <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">Ethio-Italy Polytechnic College</span>
                  <span className="text-slate-300">/</span>
                  <span>Biometric Attendance</span>
                </div>
              )}
            </div>

            {/* Center: Minimal Segmented Terminal Switcher on Terminal Routes */}
            {isTerminalRoute && (
              <nav
                aria-label="Terminal mode switcher"
                className={`inline-flex items-center rounded-lg border p-0.5 ${
                  darkShell
                    ? "border-[#1E293B] bg-[#121826]"
                    : "border-[#EAECEF] bg-[#F6F7F9]"
                }`}
              >
                {TERMINAL_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={true}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        isActive
                          ? darkShell
                            ? "bg-[#1E293B] text-white"
                            : "bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
                          : darkShell
                          ? "text-slate-400 hover:text-slate-200"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      <Icon
                        className={`h-3.5 w-3.5 ${
                          isActive
                            ? darkShell
                              ? "text-emerald-400"
                              : "text-[#4F46E5]"
                            : ""
                        }`}
                      />
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
              </nav>
            )}

            {/* Right: Dual EAT + Ethiopian Time + Quick Mode/Auth */}
            <div className="flex items-center gap-2.5 shrink-0">
              <div
                className={`hidden sm:flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[11px] font-mono tabular-nums ${
                  darkShell
                    ? "border-[#1E293B] bg-[#121826] text-slate-300"
                    : "border-[#EAECEF] bg-[#FAFBFD] text-slate-600"
                }`}
                title="East Africa Time (UTC+3) and Ethiopian Local Clock"
              >
                <Clock className={`h-3 w-3 shrink-0 ${darkShell ? "text-indigo-400" : "text-[#4F46E5]"}`} />
                <span>EAT {currentTime || "--:--:--"}</span>
                {ethiopianTime && (
                  <>
                    <span className={darkShell ? "text-slate-600" : "text-slate-300"}>|</span>
                    <span className={darkShell ? "text-amber-400 font-medium" : "text-amber-700 font-medium"}>
                      EC {ethiopianTime}
                    </span>
                  </>
                )}
              </div>

              {isTerminalRoute && !user && (
                <Link
                  href="/login"
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                    darkShell
                      ? "bg-[#4F46E5] text-white hover:bg-[#4338CA]"
                      : "border border-[#E5E7EB] bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Lock className="h-3 w-3" />
                  <span className="hidden sm:inline">Admin</span>
                </Link>
              )}
            </div>
          </div>
        </header>

        {/* Page Viewport */}
        <main
          className={`flex-1 w-full ${
            isEntranceRoute
              ? "px-3 py-3 sm:px-5 sm:py-4"
              : isTerminalRoute
              ? "mx-auto max-w-[1280px] px-4 py-5 sm:px-6"
              : "mx-auto max-w-[1340px] px-4 py-6 sm:px-6 lg:px-8"
          }`}
        >
          {children}
        </main>

        {isWorkspaceRoute && (
          <footer className="border-t border-[#EAECEF] bg-white py-2.5 px-6 text-[11px] text-slate-400">
            <div className="mx-auto max-w-[1340px] flex flex-col sm:flex-row items-center justify-between gap-1">
              <span>© 2026 Ethio-Italy Polytechnic College (EIPC), Dire Dawa</span>
              <span>Faceo Biometric Attendance</span>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
