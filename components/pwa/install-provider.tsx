"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { isIosLike, isStandaloneMode } from "@/lib/pwa";

type InstallPromptOutcome = { outcome: "accepted" | "dismissed" };

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallPromptOutcome>;
};

type InstallContextValue = {
  canPrompt: boolean;
  installed: boolean;
  isIos: boolean;
  promptInstall: () => Promise<InstallPromptOutcome | null>;
};

const InstallContext = createContext<InstallContextValue | null>(null);

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

export function InstallProvider({ children }: { children: React.ReactNode }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const updatePlatform = () => {
      setInstalled(isStandaloneMode({
        displayModeMatches: media.matches,
        navigatorStandalone: navigator.standalone,
      }));
      setIsIos(isIosLike({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
      }));
    };
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setInstalled(true);
    };
    updatePlatform();
    media.addEventListener("change", updatePlatform);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      media.removeEventListener("change", updatePlatform);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!promptEvent) return null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setPromptEvent(null);
    return choice;
  }, [promptEvent]);

  const value = useMemo<InstallContextValue>(() => ({
    canPrompt: Boolean(promptEvent),
    installed,
    isIos,
    promptInstall,
  }), [installed, isIos, promptEvent, promptInstall]);

  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>;
}

export function useInstallApp() {
  const value = useContext(InstallContext);
  if (!value) throw new Error("useInstallApp precisa estar dentro de InstallProvider.");
  return value;
}
