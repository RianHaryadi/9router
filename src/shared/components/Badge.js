"use client";

import { cn } from "@/shared/utils/cn";

// Ops Console: status colours come from the theme tokens, so a palette change
// lands everywhere instead of leaving hardcoded Tailwind greens behind.
const variants = {
  default: "bg-surface-2 text-text-muted border border-border-subtle",
  primary: "bg-brand-500/10 text-brand-600 dark:text-brand-300 border border-brand-500/20",
  success: "bg-success/10 text-success border border-success/25",
  warning: "bg-warning/10 text-warning border border-warning/25",
  error: "bg-danger/10 text-danger border border-danger/25",
  info: "bg-info/10 text-info border border-info/25",
};

const dots = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-danger",
  info: "bg-info",
  primary: "bg-brand-500",
  default: "bg-text-subtle",
};

const sizes = {
  sm: "px-1.5 py-0.5 text-[10px] tracking-wide",
  md: "px-2 py-0.5 text-[11px] tracking-wide",
  lg: "px-2.5 py-1 text-xs",
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
        "inline-flex items-center gap-1.5 rounded-md font-medium uppercase",
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
