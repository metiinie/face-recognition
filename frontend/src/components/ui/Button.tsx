import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2 } from "lucide-react";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "success" | "danger" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", isLoading = false, children, disabled, ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center gap-2 font-medium tracking-[-0.01em] rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 disabled:opacity-50 disabled:pointer-events-none select-none";

    const variants = {
      primary:
        "bg-[#4F46E5] hover:bg-[#4338CA] text-white border border-[#4338CA]/10 shadow-[0_1px_2px_rgba(79,70,229,0.18)]",
      secondary:
        "bg-[#0F172A] hover:bg-[#1E293B] text-white border border-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.12)]",
      success:
        "bg-[#059669] hover:bg-[#047857] text-white border border-emerald-700/10 shadow-[0_1px_2px_rgba(5,150,105,0.15)]",
      danger:
        "bg-[#DC2626] hover:bg-[#B91C1C] text-white border border-rose-700/10 shadow-[0_1px_2px_rgba(220,38,38,0.15)]",
      outline:
        "bg-white hover:bg-slate-50 text-slate-700 border border-[#E5E7EB] hover:border-slate-300 shadow-[0_1px_2px_rgba(15,23,42,0.02)]",
      ghost: "bg-transparent hover:bg-slate-100/80 text-slate-600 hover:text-slate-900",
    };

    const sizes = {
      sm: "h-8 px-3 text-xs",
      md: "h-9 px-4 text-[13px]",
      lg: "h-11 px-5 text-sm",
    };

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
