"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { Bitcoin, Building2, ChartNoAxesCombined, Landmark } from "lucide-react";
import { resolveAssetLogoAction } from "../actions";
import type { AssetDto } from "../types";
import { createAssetLogoCache, type AssetLogoCache } from "./asset-logo-cache";
const AssetLogos = createContext<AssetLogoCache | null>(null);
export function AssetLogoProvider({ assets, children }: {
  assets: AssetDto[];
  children: ReactNode;
}) {
  const cacheRef = useRef<AssetLogoCache | null>(null);
  if (!cacheRef.current)
    cacheRef.current = createAssetLogoCache(resolveAssetLogoAction);
  const cache = cacheRef.current;
  const [, startTransition] = useTransition();
  useEffect(() => {
    startTransition(async () => { await Promise.all(assets.map((asset) => cache.resolve(asset))); });
  }, [assets, cache]);
  return <AssetLogos.Provider value={cache}>{children}</AssetLogos.Provider>;
}
export function AssetLogo({ asset }: {
  asset: AssetDto;
}) {
  const cache = useContext(AssetLogos);
  if (!cache)
    throw new Error("AssetLogo requer AssetLogoProvider.");
  const subscribe = useCallback((listener: () => void) => cache.subscribe(asset, listener), [cache, asset]);
  const getSnapshot = useCallback(() => cache.getSnapshot(asset), [cache, asset]);
  // The immutable entry is also the server snapshot. Both responsive trees render
  // the same initial URL and resolution only starts after hydration.
  const { logoUrl, displayedLogoUrl } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [loadedLogoUrl, setLoadedLogoUrl] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const captureLogoElement = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete) {
      setLoadedLogoUrl(image.naturalWidth > 0 ? displayedLogoUrl : null);
      // An SSR image can fail before React attaches its onError handler.
      // Recover that completed request through the same shared retry policy.
      if (image.naturalWidth === 0 && displayedLogoUrl)
        startTransition(async () => { await cache.fail(asset, displayedLogoUrl); });
    }
  }, [asset, cache, displayedLogoUrl]);
  return (<span data-asset-logo-container className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border bg-white/95 text-neutral-500">
    {asset.instrumentType === "CRYPTO"
      ? <Bitcoin className="size-4" aria-hidden="true" />
      : asset.instrumentType === "FIXED_INCOME"
        ? <Landmark className="size-4" aria-hidden="true" />
        : asset.instrumentType === "ETF"
          ? <ChartNoAxesCombined className="size-4" aria-hidden="true" />
          : <Building2 className="size-4" aria-hidden="true" />}
    {logoUrl && (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={displayedLogoUrl} data-asset-logo ref={captureLogoElement} src={displayedLogoUrl ?? undefined} alt={`Logo de ${asset.name}`} className={`absolute inset-[2px] h-[calc(100%-4px)] w-[calc(100%-4px)] rounded-[9px] bg-white object-contain ${loadedLogoUrl === displayedLogoUrl ? "opacity-100" : "opacity-0"}`} loading="lazy" onLoad={(event) => {
        if (event.currentTarget.naturalWidth > 0)
          setLoadedLogoUrl(displayedLogoUrl);
      }} onError={() => {
        setLoadedLogoUrl(null);
        if (displayedLogoUrl)
          startTransition(async () => { await cache.fail(asset, displayedLogoUrl); });
      }} />)}
  </span>);
}
