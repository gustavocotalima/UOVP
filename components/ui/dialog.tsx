"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CircleHelp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const openDialogs: string[] = [];
let bodyLockCount = 0;
let originalBodyOverflow = "";

function focusableElements(panel: HTMLElement | null) {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(
    "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

function initialFocusableElement(
  panel: HTMLElement | null,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const initialTarget = initialFocusRef?.current;
  if (initialTarget) {
    if (initialTarget.matches(
      "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )) {
      return initialTarget;
    }
    return focusableElements(initialTarget)[0] ?? panel;
  }
  return focusableElements(panel)[0] ?? panel;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  titleAlign = "left",
  dismissible = true,
  initialFocusRef,
  mobileMode = "sheet",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  titleAlign?: "left" | "center";
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  mobileMode?: "sheet" | "full";
}) {
  const dialogId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const dismissibleRef = useRef(dismissible);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  useEffect(() => {
    dismissibleRef.current = dismissible;
  }, [dismissible]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    openDialogs.push(dialogId);
    if (bodyLockCount === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    bodyLockCount += 1;
    const backgroundElements = Array.from(document.body.children)
      .filter((element): element is HTMLElement =>
        element instanceof HTMLElement && element.dataset.dialogId !== dialogId,
      )
      .map((element) => ({ element, inert: element.inert }));
    for (const { element } of backgroundElements) element.inert = true;
    const timer = window.setTimeout(() => {
      initialFocusableElement(panelRef.current, initialFocusRef)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (openDialogs.at(-1) !== dialogId) return;
      if (event.key === "Escape" && dismissibleRef.current) {
        event.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(panelRef.current);
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      const stackIndex = openDialogs.lastIndexOf(dialogId);
      if (stackIndex >= 0) openDialogs.splice(stackIndex, 1);
      for (const { element, inert } of backgroundElements) element.inert = inert;
      bodyLockCount = Math.max(0, bodyLockCount - 1);
      if (bodyLockCount === 0) document.body.style.overflow = originalBodyOverflow;
      previous?.focus();
    };
  }, [dialogId, initialFocusRef, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-dialog-id={dialogId}
      className="fixed inset-0 z-[100] grid place-items-end overflow-y-auto bg-black/70 p-0 backdrop-blur-[2px] sm:place-items-center sm:p-4"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "flex w-full max-w-3xl flex-col overflow-hidden border bg-[var(--card)] shadow-2xl sm:my-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl",
          mobileMode === "full"
            ? "h-dvh max-h-dvh rounded-none sm:h-auto"
            : "max-h-[92dvh] rounded-t-3xl",
          className,
        )}
      >
        <header className={cn("relative flex items-start justify-between gap-4 border-b px-4 py-4 sm:px-6 sm:py-5", titleAlign === "center" && "block text-center")}>
          <div className={cn(titleAlign === "center" && "px-12")}>
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>}
          </div>
          {dismissible && (
            <Button type="button" variant="ghost" size="icon" aria-label="Fechar" onClick={() => onOpenChange(false)} className={cn(titleAlign === "center" && "absolute right-4 top-3")}>
              <X className="size-5" />
            </Button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 scrollbar-thin">{children}</div>
        {footer && <footer className="flex flex-col-reverse gap-3 border-t px-4 py-4 sm:flex-row sm:justify-end sm:px-6">{footer}</footer>}
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
      onOpenChange={(nextOpen) => {
        if (!pending || nextOpen) onOpenChange(nextOpen);
      }}
      title={title}
      dismissible={!pending}
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
