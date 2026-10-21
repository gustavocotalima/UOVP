import { usableBrapiLogoUrl } from "../market-logo";
import type { AssetDto } from "../types";
type LogoAsset = Pick<AssetDto, "id" | "ticker" | "instrumentType" | "investmentClass" | "marketRegion" | "logoUrl">;
type Resolver = (input: {
  assetId: string;
  failedLogoUrls: string[];
}) => Promise<string | null>;
export type AssetLogoSnapshot = Readonly<{
  logoUrl: string | null;
  displayedLogoUrl: string | null;
}>;
type Entry = {
  storedLogoUrl: string | null;
  resolvedLogoUrl: string | null;
  failed: Set<string>;
  retried: Set<string>;
  retryLogoUrl: string | null;
  attempts: Set<string>;
  pending?: Promise<void>;
  snapshot: AssetLogoSnapshot;
  listeners: Set<() => void>;
};
/** Revisions of unrelated portfolio data must not restart a logo resolution. */
export function assetLogoSignature(asset: LogoAsset) {
  return JSON.stringify([asset.id, asset.ticker, asset.instrumentType, asset.investmentClass, asset.marketRegion, asset.logoUrl]);
}
/** One instance belongs to one mounted panel; neither users nor panels share this state. */
export function createAssetLogoCache(resolveLogo: Resolver) {
  const entries = new Map<string, Entry>();
  function entryFor(asset: LogoAsset) {
    const key = assetLogoSignature(asset);
    let entry = entries.get(key);
    if (!entry) {
      const storedLogoUrl = usableBrapiLogoUrl(asset.logoUrl);
      entry = {
        storedLogoUrl,
        resolvedLogoUrl: null,
        failed: new Set(),
        retried: new Set(),
        retryLogoUrl: null,
        attempts: new Set(),
        snapshot: { logoUrl: storedLogoUrl, displayedLogoUrl: storedLogoUrl },
        listeners: new Set(),
      };
      entries.set(key, entry);
    }
    return entry;
  }
  function publish(entry: Entry) {
    const logoUrl = [entry.resolvedLogoUrl, entry.storedLogoUrl]
      .find((candidate): candidate is string => typeof candidate === "string" && !entry.failed.has(candidate)) ?? null;
    const displayedLogoUrl = logoUrl && entry.retryLogoUrl === logoUrl
      ? `${logoUrl}${logoUrl.includes("?") ? "&" : "?"}uovp_logo_retry=1`
      : logoUrl;
    if (entry.snapshot.logoUrl === logoUrl && entry.snapshot.displayedLogoUrl === displayedLogoUrl)
      return;
    entry.snapshot = { logoUrl, displayedLogoUrl };
    entry.listeners.forEach((listener) => listener());
  }
  function resolve(asset: LogoAsset): Promise<void> {
    const entry = entryFor(asset);
    if (entry.pending)
      return entry.pending;
    if (entry.snapshot.logoUrl || !["STOCK", "ETF", "REAL_ESTATE_FUND", "REIT"].includes(asset.instrumentType))
      return Promise.resolve();
    const failedLogoUrls = [...entry.failed].sort();
    const attemptKey = JSON.stringify(failedLogoUrls);
    if (entry.attempts.has(attemptKey))
      return Promise.resolve();
    entry.attempts.add(attemptKey);
    // Retain null and failed attempts for this signature. The server remains responsible
    // for its persisted provider cooldown; mounting a second view must not bypass it.
    entry.pending = Promise.resolve().then(() => resolveLogo({ assetId: asset.id, failedLogoUrls }))
      .then((resolved) => {
        if (resolved && !entry.failed.has(resolved))
          entry.resolvedLogoUrl = resolved;
        publish(entry);
      })
      .catch(() => {
        // Keep the generic icon when the provider is unavailable.
      })
      .finally(() => { entry.pending = undefined; });
    return entry.pending;
  }
  return {
    getSnapshot: (asset: LogoAsset) => entryFor(asset).snapshot,
    subscribe(asset: LogoAsset, listener: () => void) {
      const entry = entryFor(asset);
      entry.listeners.add(listener);
      return () => { entry.listeners.delete(listener); };
    },
    resolve,
    fail(asset: LogoAsset, displayedLogoUrl: string) {
      const entry = entryFor(asset);
      // The hidden responsive image can report an older request after the shared
      // candidate already changed. Its event must not consume the current retry.
      if (entry.snapshot.displayedLogoUrl !== displayedLogoUrl)
        return Promise.resolve();
      const logoUrl = entry.snapshot.logoUrl;
      if (!logoUrl)
        return Promise.resolve();
      if (!entry.retried.has(logoUrl)) {
        entry.retried.add(logoUrl);
        entry.retryLogoUrl = logoUrl;
        publish(entry);
        return Promise.resolve();
      }
      entry.failed.add(logoUrl);
      entry.retryLogoUrl = null;
      publish(entry);
      return resolve(asset);
    },
  };
}
export type AssetLogoCache = ReturnType<typeof createAssetLogoCache>;
