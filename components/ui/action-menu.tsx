"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Ellipsis } from "lucide-react";
import { Button } from "./button";

const MENU_WIDTH = 224;
const VIEWPORT_GAP = 8;

export function ActionMenu({
  open,
  onOpenChange,
  children,
  label = "Abrir ações",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  label?: string;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    function updatePosition() {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const menuHeight = menuRef.current?.offsetHeight ?? 220;
      const left = Math.max(
        VIEWPORT_GAP,
        Math.min(trigger.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP),
      );
      const availableBelow = window.innerHeight - trigger.bottom - VIEWPORT_GAP;
      const availableAbove = trigger.top - VIEWPORT_GAP;
      const opensAbove = availableBelow < menuHeight && availableAbove > availableBelow;
      const top = opensAbove
        ? Math.max(VIEWPORT_GAP, trigger.top - menuHeight - VIEWPORT_GAP)
        : Math.min(
            trigger.bottom + VIEWPORT_GAP,
            Math.max(VIEWPORT_GAP, window.innerHeight - menuHeight - VIEWPORT_GAP),
          );
      setPosition({ left, top });
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onOpenChange(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      onOpenChange(false);
      triggerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <>
      <span ref={triggerRef} className="inline-flex">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          <Ellipsis className="size-4" />
        </Button>
      </span>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="fixed z-[80] w-56 rounded-xl border bg-[var(--card)] p-1 text-left text-[var(--card-foreground)] opacity-100 shadow-2xl"
          style={{
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            visibility: position ? "visible" : "hidden",
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
