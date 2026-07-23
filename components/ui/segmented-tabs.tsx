"use client";

import { cn } from "@/lib/utils";

export type TabOption<T extends string> = { value: T; label: string };

export function SegmentedTabs<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly TabOption<T>[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border bg-[var(--card)] p-1", className)}>
      {options.map((option) => (
        <button
          type="button"
          role="tab"
          aria-selected={value === option.value}
          key={option.value}
          onClick={() => onValueChange(option.value)}
          className={cn(
            "min-h-9 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition",
            value === option.value
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
