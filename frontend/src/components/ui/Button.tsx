import React from "react";
import clsx from "clsx";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "success" | "danger" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  isLoading = false,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const sizes = {
    sm: "h-8 px-3 text-xs rounded-md",
    md: "h-9 px-4 text-sm rounded-lg",
    lg: "h-11 px-6 text-base rounded-lg",
  };

  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm focus-visible:ring-blue-500",
    secondary: "bg-slate-800 text-white hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm focus-visible:ring-emerald-500",
    danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm focus-visible:ring-rose-500",
    outline: "border border-slate-300 bg-transparent hover:bg-slate-100 text-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800",
    ghost: "bg-transparent hover:bg-slate-100 text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
  };

  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 select-none",
        sizes[size],
        variants[variant],
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="inline-flex items-center gap-2">
          <svg className="h-4 w-4 animate-spin text-current" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>Processing...</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
