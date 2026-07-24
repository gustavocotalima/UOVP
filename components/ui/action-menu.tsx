"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
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
  const menuId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpenRef = useRef<"first" | "last">("first");
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  function menuItems() {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not([disabled])") ?? [],
    );
  }

  function focusMenuItem(positionToFocus: "first" | "last") {
    const items = menuItems();
    const item = positionToFocus === "first" ? items[0] : items.at(-1);
    item?.focus();
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    focusOnOpenRef.current = event.key === "ArrowDown" ? "first" : "last";
    if (open) focusMenuItem(focusOnOpenRef.current);
    else {
      setPosition(null);
      onOpenChange(true);
    }
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = menuItems();
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    else if (event.key === "ArrowUp") nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "Tab") {
      event.preventDefault();
      onOpenChange(false);
      triggerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    } else {
      return;
    }
    event.preventDefault();
    items[nextIndex].focus();
  }

  useEffect(() => {
    if (!open) return;

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
    const focusTimer = window.setTimeout(() => {
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not([disabled])") ?? [],
      );
      const item = focusOnOpenRef.current === "first" ? items[0] : items.at(-1);
      item?.focus();
    });
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
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
          aria-controls={open ? menuId : undefined}
          onClick={() => {
            focusOnOpenRef.current = "first";
            if (!open) setPosition(null);
            onOpenChange(!open);
          }}
          onKeyDown={handleTriggerKeyDown}
        >
          <Ellipsis className="size-4" />
        </Button>
      </span>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
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
