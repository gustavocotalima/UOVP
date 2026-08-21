import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  getSharedCacheMany: vi.fn(),
  setSharedCacheMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketAssetMetadata: {
      findMany: mocks.findMany,
      upsert: mocks.upsert,
    },
  },
}));

vi.mock("@/lib/shared-cache", () => ({
  sharedCacheKey: (scope: string, ...parts: unknown[]) => `${scope}:${parts.join(":")}`,
  getSharedCacheMany: mocks.getSharedCacheMany,
  setSharedCacheMany: mocks.setSharedCacheMany,
}));

import {
  readMarketMetadata,
  saveMissingMarketMetadata,
  saveVerifiedMarketMetadata,
} from "@/features/portfolio/market-metadata";

function storedMetadata(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-08-21T12:00:00.000Z");
  return {
    id: "metadata-1",
    provider: "BRAPI",
    symbol: "EMBJ3",
    name: "Embraer S.A.",
    logoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
    status: "VERIFIED",
    source: "CATALOG",
    resolvedAt: now,
    lastAttemptAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("persistência compartilhada de metadados de mercado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSharedCacheMany.mockResolvedValue(new Map());
    mocks.setSharedCacheMany.mockResolvedValue(undefined);
  });

  it("repopula o Redis pelo Postgres sem consultar o provedor", async () => {
    mocks.findMany.mockResolvedValue([storedMetadata()]);

    const result = await readMarketMetadata("BRAPI", ["embj3"]);

    expect(result.get("EMBJ3")?.logoUrl).toBe("https://icons.brapi.dev/icons/EMBR3.svg");
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { provider: "BRAPI", symbol: { in: ["EMBJ3"] } },
    });
    expect(mocks.setSharedCacheMany).toHaveBeenCalledWith([
      expect.objectContaining({
        key: "market:metadata:v2:BRAPI:EMBJ3",
        ttlSeconds: undefined,
      }),
    ]);
  });

  it("mantém metadados verificados sem expiração", async () => {
    mocks.upsert.mockResolvedValue(storedMetadata());

    await saveVerifiedMarketMetadata({
      provider: "BRAPI",
      symbol: "EMBJ3",
      name: "Embraer S.A.",
      logoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
      source: "CATALOG",
    });

    expect(mocks.setSharedCacheMany).toHaveBeenCalledWith([
      expect.objectContaining({ ttlSeconds: undefined }),
    ]);
  });

  it("limita o cache negativo a 24 horas", async () => {
    mocks.upsert.mockResolvedValue(storedMetadata({
      logoUrl: null,
      status: "MISSING",
      resolvedAt: null,
    }));

    await saveMissingMarketMetadata({
      provider: "BRAPI",
      symbol: "UNKNOWN3",
      name: null,
      source: "CATALOG",
    });

    expect(mocks.setSharedCacheMany).toHaveBeenCalledWith([
      expect.objectContaining({ ttlSeconds: 86_400 }),
    ]);
  });
});
