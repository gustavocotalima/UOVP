"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestDataRefresh, subscribeDataRefresh } from "@/lib/client-data-refresh";
import { createSyncStatusPoller, type PluggySyncStatus } from "./sync-status-poller";

export function usePluggySyncStatus() {
  const router = useRouter();
  const [status, setStatus] = useState<PluggySyncStatus>({ active: false, automatic: false });
  const pollerRef = useRef<ReturnType<typeof createSyncStatusPoller> | null>(null);

  useEffect(() => {
    const poller = createSyncStatusPoller({
      async fetchStatus(signal) {
        const response = await fetch("/api/pluggy/sync-status", {
          credentials: "same-origin",
          cache: "no-store",
          signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok || !payload || typeof payload !== "object"
          || !("active" in payload) || typeof payload.active !== "boolean"
          || !("automatic" in payload) || typeof payload.automatic !== "boolean") {
          throw new Error("Status de sincronização inválido.");
        }
        return { active: payload.active, automatic: payload.automatic };
      },
      isVisible: () => document.visibilityState !== "hidden",
      onStatus: setStatus,
      onComplete: () => requestDataRefresh(() => router.refresh(), { pluggyCompleted: true }),
    });
    pollerRef.current = poller;
    const unsubscribe = subscribeDataRefresh(({ pluggyCompleted }) => {
      if (pluggyCompleted) poller.acknowledgeRefresh();
    });
    const onVisibilityChange = () => poller.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibilityChange);
    poller.start();
    return () => {
      unsubscribe();
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  const beginLocalSync = useCallback(() => pollerRef.current?.beginLocalOperation() ?? (() => {}), []);
  return { status, beginLocalSync };
}
