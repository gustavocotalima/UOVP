"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type TabOption<T extends string> = {
  value: T;
  label: string;
  panelId?: string;
  tabId?: string;
};

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
  const generatedId = useId();
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);

  function selectTab(index: number) {
    const option = options[index];
    if (!option) return;
    onValueChange(option.value);
    tabsRef.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % options.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + options.length) % options.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectTab(nextIndex);
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex w-fit max-w-full snap-x gap-1 overflow-x-auto rounded-xl border bg-[var(--card)] p-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)] [&::-webkit-scrollbar]:hidden", className)}>
      {options.map((option, index) => (
        <button
          type="button"
          role="tab"
          id={option.tabId ?? `${generatedId}-tab-${index}`}
          aria-controls={option.panelId}
          aria-selected={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          key={option.value}
          ref={(element) => {
            tabsRef.current[index] = element;
          }}
          onClick={() => onValueChange(option.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={cn(
            "min-h-11 snap-start whitespace-nowrap rounded-lg px-3 text-sm font-medium transition sm:min-h-9",
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
