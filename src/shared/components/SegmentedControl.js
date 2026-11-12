"use client";

import { cn } from "@/shared/utils/cn";

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
}) {
  const sizes = {
    sm: "h-6 text-[11px]",
    md: "h-8 text-[12px]",
    lg: "h-10 text-[13px]",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center p-0.5 rounded-lg overflow-x-auto",
        "bg-surface-2 border border-border-subtle",
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "shrink-0 px-3 rounded-md font-medium transition-colors",
            sizes[size],
            value === option.value
              ? "bg-surface text-text-main border border-border-subtle"
              : "text-text-muted hover:text-text-main border border-transparent"
          )}
        >
          {option.icon && (
            <span className="material-symbols-outlined text-[15px] mr-1.5">
              {option.icon}
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
