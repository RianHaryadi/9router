"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  default: "bg-surface-2 text-text-main border-2 border-ink",
  primary: "bg-ink text-[#FAF7F0] border-2 border-ink",
  success: "bg-success/15 text-success border border-success/30",
  warning: "bg-warning/15 text-warning border border-warning/30",
  error: "bg-danger/15 text-danger border border-danger/30",
  info: "bg-info/15 text-info border border-info/30",
};

const dots = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-danger",
  info: "bg-info",
  primary: "bg-brand-600",
  default: "bg-text-muted",
};

const sizes = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-0.5 text-[11px]",
  lg: "px-2.5 py-1 text-[12px]",
};

export default function Badge({
  children,
  variant = "default",
  size = "md",
  dot = false,
  icon,
  className,
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[6px] font-semibold",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            dots[variant] || dots.default
          )}
        />
      )}
      {icon && <span className="material-symbols-outlined text-[13px]">{icon}</span>}
      {children}
    </span>
  );
}
