"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import {
  Building2,
  Lock,
  User,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  Sparkles,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMessage("Please enter both username and password.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      await api.login(username.trim(), password);
      // Redirect to HR Dashboard upon successful sign-in
      router.push("/dashboard");
    } catch (err: any) {
      setErrorMessage(err.message || "Invalid credentials. Please verify and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickFill = (user: string, pass: string) => {
    setUsername(user);
    setPassword(pass);
    setErrorMessage(null);
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center py-8 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-6">
        {/* College Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/25">
            <Building2 className="h-7 w-7" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Ethio-Italy Polytechnic College
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Attendance Management & Biometric System (Dire Dawa)
          </p>
        </div>

        {/* Login Card */}
        <Card className="border-slate-200/80 shadow-xl backdrop-blur-sm dark:border-slate-800">
          <CardHeader className="space-y-1 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Staff Authentication</CardTitle>
              <Badge variant="brand" className="text-[10px]">
                RBAC Secured
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Enter your authorized staff credentials to access administrative and reporting portals.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {errorMessage && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Username
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <User className="h-4 w-4" />
                  </div>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. hr_officer or admin"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Password
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-9 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full mt-2"
                isLoading={isLoading}
              >
                <span>Sign In to College Portal</span>
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </form>

            {/* Demo Quick-Fill Roles */}
            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2">
                <Sparkles className="h-3 w-3 text-blue-500" />
                <span>Authorized Demo Credentials:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickFill("hr_officer", "Hr@EIPC2026")}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-left hover:border-blue-300 hover:bg-blue-50/50 transition-all dark:border-slate-800 dark:bg-slate-900"
                >
                  <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">HR Officer</p>
                  <p className="text-[10px] text-slate-500 font-mono">hr_officer</p>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickFill("admin", "Admin@EIPC2026")}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-left hover:border-blue-300 hover:bg-blue-50/50 transition-all dark:border-slate-800 dark:bg-slate-900"
                >
                  <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">System Admin</p>
                  <p className="text-[10px] text-slate-500 font-mono">admin</p>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickFill("auditor", "Audit@EIPC2026")}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-left hover:border-blue-300 hover:bg-blue-50/50 transition-all dark:border-slate-800 dark:bg-slate-900"
                >
                  <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">Auditor</p>
                  <p className="text-[10px] text-slate-500 font-mono">auditor</p>
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Security Notice */}
        <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          <span>Biometric templates protected by AES-128-CBC + HMAC-SHA256 at rest</span>
        </div>
      </div>
    </div>
  );
}

