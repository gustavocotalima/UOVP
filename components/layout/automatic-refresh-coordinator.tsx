"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import {
  AUTOMATIC_REFRESH_BACKGROUND_MS,
} from "@/lib/automatic-refresh-policy";
import type { BootstrapRefreshResponse } from "@/lib/bootstrap-refresh";
import { cn } from "@/lib/utils";

const SESSION_KEY = "uovp:bootstrap-refresh:last-check";

function responseIsValid(value: unknown): value is BootstrapRefreshResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BootstrapRefreshResponse>;
  return [candidate.market, candidate.accounts, candidate.pluggy].every((result) =>
    result
    && ["SKIPPED", "UPDATED", "PARTIAL", "FAILED"].includes(result.status)
    && typeof result.changed === "boolean",
  );
}

export function AutomaticRefreshCoordinator() {
  const router = useRouter();
  const runningRef = useRef(false);
  const hiddenAtRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const [notice, setNotice] = useState<{
    kind: "loading" | "success" | "warning";
    text: string;
  } | null>(null);

  const clearNoticeLater = useCallback((milliseconds: number) => {
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => setNotice(null), milliseconds);
  }, []);

  const run = useCallback(async (forceCheck = false) => {
    if (runningRef.current) return;
    const now = Date.now();
    try {
      const lastCheck = Number(sessionStorage.getItem(SESSION_KEY) ?? 0);
      if (!forceCheck && Number.isFinite(lastCheck) && now - lastCheck < AUTOMATIC_REFRESH_BACKGROUND_MS) {
        return;
      }
      sessionStorage.setItem(SESSION_KEY, String(now));
    } catch {
      // sessionStorage is only a client-side throttle; the server remains authoritative.
    }

    runningRef.current = true;
    const loadingTimer = window.setTimeout(() => {
      setNotice({ kind: "loading", text: "Atualizando cotações, câmbio e Open Finance…" });
    }, 400);
    try {
      const response = await fetch("/api/bootstrap-refresh", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !responseIsValid(payload)) {
        throw new Error("Não foi possível concluir a atualização automática.");
      }
      if (payload.market.changed || payload.accounts.changed || payload.pluggy.changed) {
        router.refresh();
      }
      const failed = [payload.market, payload.accounts, payload.pluggy].filter((result) =>
        result.status === "FAILED" || result.status === "PARTIAL"
      );
      if (failed.length) {
        setNotice({
          kind: "warning",
          text: failed.map((result) => result.message).filter(Boolean).join(" ")
            || "Alguns dados não puderam ser atualizados. Os valores anteriores foram preservados.",
        });
        clearNoticeLater(8_000);
      } else if (payload.market.changed || payload.accounts.changed || payload.pluggy.changed) {
        setNotice({ kind: "success", text: "Dados atualizados." });
        clearNoticeLater(3_500);
      } else {
        setNotice(null);
      }
    } catch {
      setNotice({
        kind: "warning",
        text: "Não foi possível atualizar agora. Os dados anteriores foram preservados.",
      });
      clearNoticeLater(8_000);
    } finally {
      window.clearTimeout(loadingTimer);
      runningRef.current = false;
    }
  }, [clearNoticeLater, router]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void run(), 0);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt && Date.now() - hiddenAt >= AUTOMATIC_REFRESH_BACKGROUND_MS) {
        void run(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(initialTimer);
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [run]);

  if (!notice) return null;
  const Icon = notice.kind === "loading"
    ? LoaderCircle
    : notice.kind === "success"
      ? CheckCircle2
      : AlertTriangle;
  return (
    <div
      aria-live="polite"
      role={notice.kind === "warning" ? "status" : undefined}
      className={cn(
        "pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border bg-[var(--card)]/95 px-4 py-2 text-xs font-medium shadow-xl backdrop-blur lg:bottom-5",
        notice.kind === "warning" && "border-[var(--danger)]/35 text-[var(--danger)]",
        notice.kind === "success" && "border-[var(--success)]/35 text-[var(--success)]",
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", notice.kind === "loading" && "animate-spin")}
        aria-hidden="true"
      />
      <span className="line-clamp-2">{notice.text}</span>
    </div>
  );
}
