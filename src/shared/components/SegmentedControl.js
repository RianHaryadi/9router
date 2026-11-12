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
    sm: "h-7 text-[11px]",
    md: "h-9 text-[12px]",
    lg: "h-11 text-[13px]",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center p-0.5 rounded-[12px] overflow-x-auto",
        "bg-surface-2 border-2 border-ink",
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "shrink-0 px-3 rounded-[3px] font-bold transition-all",
            sizes[size],
            value === option.value
              ? "bg-ink text-[#FAF7F0] border-2 border-ink"
              : "text-text-muted hover:text-text-main border-2 border-transparent"
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
