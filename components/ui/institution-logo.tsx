"use client";

import { useCallback, useState } from "react";
import { Building2, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

const LOGO_ZOOM_BY_FILENAME: Record<string, number> = {
  "202.svg": 1.45, // XP
  "206.svg": 1.3, // Mercado Pago
  "214.svg": 1.4, // BTG Pactual
};

function logoZoom(src: string | null) {
  if (!src) return 1;
  const filename = src.split("?")[0]?.split("/").pop()?.toLowerCase();
  return filename ? LOGO_ZOOM_BY_FILENAME[filename] ?? 1 : 1;
}

export function InstitutionLogo({
  src,
  name,
  kind = "bank",
  size = "default",
}: {
  src: string | null;
  name: string;
  kind?: "bank" | "card";
  size?: "default" | "large";
}) {
  const [loadedLogoUrl, setLoadedLogoUrl] = useState<string | null>(null);
  const logoLoaded = Boolean(src) && loadedLogoUrl === src;
  const captureLogoElement = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete) {
      setLoadedLogoUrl(image.naturalWidth > 0 ? src : null);
    }
  }, [src]);
  const FallbackIcon = kind === "card" ? CreditCard : Building2;

  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden border bg-white/95 text-neutral-500",
        size === "large" ? "size-14 rounded-2xl" : "size-11 rounded-xl",
      )}
    >
      {!logoLoaded && (
        <FallbackIcon
          className={size === "large" ? "size-6" : "size-5"}
          aria-hidden="true"
        />
      )}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={captureLogoElement}
          src={src}
          alt={`Logo de ${name}`}
          className={cn(
            "absolute inset-px h-[calc(100%-2px)] w-[calc(100%-2px)] object-contain",
            size === "large" ? "rounded-[15px]" : "rounded-[11px]",
            logoLoaded ? "opacity-100" : "opacity-0",
          )}
          style={{ transform: `scale(${logoZoom(src)})` }}
          loading="lazy"
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth > 0) setLoadedLogoUrl(src);
          }}
          onError={() => setLoadedLogoUrl(null)}
        />
      )}
    </span>
  );
}
