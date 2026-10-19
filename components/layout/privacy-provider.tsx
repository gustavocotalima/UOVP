"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { PRIVACY_COOKIE } from "@/lib/privacy";

const PrivacyContext = createContext({
  valuesHidden: false,
  toggleValues: () => {},
});

export function PrivacyProvider({ initialHidden, children }: { initialHidden: boolean; children: ReactNode }) {
  const [valuesHidden, setValuesHidden] = useState(initialHidden);

  function toggleValues() {
    const next = !valuesHidden;
    document.documentElement.dataset.privateValues = String(next);
    setValuesHidden(next);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${PRIVACY_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }

  return <PrivacyContext.Provider value={{ valuesHidden, toggleValues }}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
