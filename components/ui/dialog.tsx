"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CircleHelp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  titleAlign = "left",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  titleAlign?: "left" | "center";
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])",
      );
      focusable?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChangeRef.current(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border bg-[var(--card)] shadow-2xl",
          className,
        )}
      >
        <header className={cn("relative flex items-start justify-between gap-4 border-b px-6 py-5", titleAlign === "center" && "block text-center")}>
          <div className={cn(titleAlign === "center" && "px-12")}>
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>}
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Fechar" onClick={() => onOpenChange(false)} className={cn(titleAlign === "center" && "absolute right-4 top-3")}>
            <X className="size-5" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-6 scrollbar-thin">{children}</div>
        {footer && <footer className="flex flex-col-reverse gap-3 border-t px-6 py-4 sm:flex-row sm:justify-end">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const Icon = danger ? AlertTriangle : CircleHelp;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      className="max-w-lg"
      footer={
        <>
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={pending}>{cancelLabel}</Button>
          <Button type="button" variant={danger ? "danger" : "default"} className="w-full sm:w-auto" onClick={onConfirm} disabled={pending}>
            {pending ? "Aguarde…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-4 rounded-2xl border bg-[var(--muted)]/35 p-4">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl",
            danger
              ? "bg-[var(--danger)]/12 text-[var(--danger)]"
              : "bg-[var(--primary)]/12 text-[var(--primary)]",
          )}
        >
          <Icon className="size-5" />
        </span>
        <p className="pt-1 text-sm leading-6 text-[var(--muted-foreground)]">{description}</p>
      </div>
    </Dialog>
  );
}

type ConfirmationOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolver?.(confirmed);
  }, []);

  const requestConfirmation = useCallback((nextOptions: ConfirmationOptions) => {
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(nextOptions);
    });
  }, []);

  useEffect(
    () => () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    },
    [],
  );

  const confirmationDialog = (
    <ConfirmDialog
      open={Boolean(options)}
      onOpenChange={(open) => !open && settle(false)}
      title={options?.title ?? ""}
      description={options?.description ?? ""}
      confirmLabel={options?.confirmLabel}
      cancelLabel={options?.cancelLabel}
      danger={options?.danger}
      onConfirm={() => settle(true)}
    />
  );

  return { requestConfirmation, confirmationDialog };
}
