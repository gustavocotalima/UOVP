import { describe, expect, it, vi } from "vitest";
import { assetLogoSignature, createAssetLogoCache } from "@/features/portfolio/assets-panel/asset-logo-cache";

type LogoAsset = Parameters<ReturnType<typeof createAssetLogoCache>["resolve"]>[0];

function asset(overrides: Partial<LogoAsset> = {}): LogoAsset {
  return {
    id: "asset-1", ticker: "EMBJ3", instrumentType: "STOCK" as const,
    investmentClass: "BRAZILIAN_STOCKS" as const, marketRegion: null,
    logoUrl: null as string | null, ...overrides,
  };
}

describe("cache de logos compartilhado pelas apresentações da carteira", () => {
  it("coalesce duas views, publica o mesmo resultado e mantém snapshots estáveis", async () => {
    let finish!: (value: string | null) => void;
    const resolver = vi.fn(() => new Promise<string | null>((resolve) => { finish = resolve; }));
    const cache = createAssetLogoCache(resolver);
    const item = asset();
    const desktop = vi.fn();
    const mobile = vi.fn();
    cache.subscribe(item, desktop);
    cache.subscribe({ ...item }, mobile);
    const initial = cache.getSnapshot(item);
    expect(cache.getSnapshot({ ...item })).toBe(initial);

    const first = cache.resolve(item);
    const second = cache.resolve({ ...item });
    expect(second).toBe(first);
    await Promise.resolve();
    expect(resolver).toHaveBeenCalledTimes(1);
    finish("https://icons.brapi.dev/icons/EMBR3.svg");
    await first;

    expect(desktop).toHaveBeenCalledTimes(1);
    expect(mobile).toHaveBeenCalledTimes(1);
    expect(cache.getSnapshot(item)).toBe(cache.getSnapshot({ ...item }));
    expect(cache.getSnapshot(item).logoUrl).toContain("EMBR3.svg");
    await cache.resolve({ ...item });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("preserva tentativa ausente e erro do provedor ao receber outro snapshot da página", async () => {
    const resolver = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("offline"));
    const cache = createAssetLogoCache(resolver);
    const item = asset();
    await cache.resolve(item);
    await cache.resolve({ ...item });
    // A new page revision does not authorize a new provider attempt or bypass its cooldown.
    expect(resolver).toHaveBeenCalledTimes(1);
    const changed = asset({ ticker: "PETR4" });
    await cache.resolve(changed);
    await cache.resolve({ ...changed });
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(cache.getSnapshot(changed).logoUrl).toBeNull();
  });

  it("reutiliza a URL inicial no SSR e só resolve após esgotar um retry compartilhado", async () => {
    const broken = "https://icons.brapi.dev/icons/old.svg";
    const repaired = "https://icons.brapi.dev/icons/new.svg";
    const resolver = vi.fn().mockResolvedValue(repaired);
    const cache = createAssetLogoCache(resolver);
    const item = asset({ logoUrl: broken });
    expect(cache.getSnapshot(item)).toEqual({ logoUrl: broken, displayedLogoUrl: broken });
    await cache.resolve(item);
    expect(resolver).not.toHaveBeenCalled();

    await cache.fail(item, broken);
    const retry = cache.getSnapshot(item).displayedLogoUrl!;
    expect(retry).toBe(`${broken}?uovp_logo_retry=1`);
    // Error from the other image's original request cannot consume the retry.
    await cache.fail(item, broken);
    expect(cache.getSnapshot(item).displayedLogoUrl).toBe(retry);
    expect(resolver).not.toHaveBeenCalled();

    await Promise.all([cache.fail(item, retry), cache.fail(item, retry)]);
    expect(resolver).toHaveBeenCalledExactlyOnceWith({ assetId: item.id, failedLogoUrls: [broken] });
    expect(cache.getSnapshot(item).displayedLogoUrl).toBe(repaired);
    await cache.fail(item, retry);
    expect(cache.getSnapshot(item).displayedLogoUrl).toBe(repaired);
  });

  it("não volta a exibir uma URL já rejeitada pelo navegador", async () => {
    const broken = "https://icons.brapi.dev/icons/old.svg";
    const resolver = vi.fn().mockResolvedValue(broken);
    const cache = createAssetLogoCache(resolver);
    const item = asset({ logoUrl: broken });
    await cache.fail(item, broken);
    await cache.fail(item, cache.getSnapshot(item).displayedLogoUrl!);
    await cache.resolve(item);
    expect(cache.getSnapshot(item).logoUrl).toBeNull();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("desinscreve cada view sem retirar a assinatura da outra", async () => {
    const cache = createAssetLogoCache(vi.fn().mockResolvedValue("https://example.test/logo.svg"));
    const item = asset();
    const removed = vi.fn();
    const active = vi.fn();
    const unsubscribe = cache.subscribe(item, removed);
    const unsubscribeActive = cache.subscribe(item, active);
    unsubscribe();
    await cache.resolve(item);
    expect(removed).not.toHaveBeenCalled();
    expect(active).toHaveBeenCalledTimes(1);
    unsubscribeActive();
    await cache.fail(item, cache.getSnapshot(item).displayedLogoUrl!);
    expect(active).toHaveBeenCalledTimes(1);
  });

  it("invalida apenas a identidade relevante do ativo e mantém caches isolados por painel", async () => {
    const firstResolver = vi.fn().mockResolvedValue(null);
    const secondResolver = vi.fn().mockResolvedValue(null);
    const first = createAssetLogoCache(firstResolver);
    const second = createAssetLogoCache(secondResolver);
    const item = asset();
    const renamed = { ...item, name: "nome atualizado" };
    expect(assetLogoSignature(renamed)).toBe(assetLogoSignature(item));
    await first.resolve(item);
    await second.resolve(item);
    await first.resolve(asset({ instrumentType: "CRYPTO" }));
    expect(firstResolver).toHaveBeenCalledTimes(1);
    expect(secondResolver).toHaveBeenCalledTimes(1);
  });
});
