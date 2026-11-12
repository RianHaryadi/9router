"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "bg-brand-500 text-on-brand border-2 border-ink hover:bg-brand-600 shadow-[3px_3px_0_0_var(--color-shadow)] hover:translate-y-[-1px] transition-all",
  secondary: "bg-info text-white border-2 border-ink hover:opacity-90 shadow-[3px_3px_0_0_var(--color-shadow)] hover:translate-y-[-1px] transition-all",
  outline: "bg-transparent border-2 border-ink text-text-main hover:bg-surface-2 hover:shadow-[3px_3px_0_0_var(--color-shadow)] transition-all",
  ghost: "bg-transparent border-2 border-transparent text-text-muted hover:bg-surface-2 hover:text-text-main",
  danger: "bg-danger text-white border-2 border-ink hover:opacity-90 shadow-[3px_3px_0_0_var(--color-shadow)] hover:translate-y-[-1px] transition-all",
  success: "bg-success text-white border-2 border-ink hover:opacity-90 shadow-[3px_3px_0_0_var(--color-shadow)] hover:translate-y-[-1px] transition-all",
};

const sizes = {
  xs: "h-7 px-2.5 text-[11px] rounded-[6px] gap-1.5 font-semibold",
  sm: "h-8 px-3 text-[12px] rounded-[6px] font-semibold",
  md: "h-9 px-4 text-[13px] rounded-[7px] font-semibold",
  lg: "h-11 px-5 text-[14px] rounded-[8px] font-bold",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-all duration-150 ease-out cursor-pointer",
        "active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-x-0 disabled:active:translate-y-0",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className={cn("material-symbols-outlined animate-spin", size === "xs" ? "text-[14px]" : "text-[18px]")}>progress_activity</span>
      ) : icon ? (
        <span className={cn("material-symbols-outlined", size === "xs" ? "text-[14px]" : "text-[18px]")}>{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span className={cn("material-symbols-outlined", size === "xs" ? "text-[14px]" : "text-[18px]")}>{iconRight}</span>
      )}
    </button>
  );
}
