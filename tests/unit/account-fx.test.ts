import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureHistoricalFxRates: vi.fn(),
  fetchYahooFxRates: vi.fn(),
  readCachedYahooQuotes: vi.fn(),
}));

vi.mock("@/features/finance/fx", () => ({
  ensureHistoricalFxRates: mocks.ensureHistoricalFxRates,
}));

vi.mock("@/features/portfolio/yahoo-finance", () => ({
  fetchYahooFxRates: mocks.fetchYahooFxRates,
  readCachedYahooQuotes: mocks.readCachedYahooQuotes,
  yahooFxSymbol: (currency: string) => currency === "USD" ? "BRL=X" : null,
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/operation-security", () => ({
  withUserOperationLease: vi.fn(),
}));

import {
  resolveCurrentFinancialFx,
  resolveHistoricalFinancialFx,
} from "@/features/finance/account-fx";

describe("câmbio de contas manuais", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCachedYahooQuotes.mockResolvedValue(new Map());
    mocks.fetchYahooFxRates.mockResolvedValue([]);
    mocks.ensureHistoricalFxRates.mockResolvedValue(new Map());
  });

  it("usa uma cotação USD/BRL compartilhada ainda fresca", async () => {
    const now = new Date("2026-08-03T12:00:00.000Z");
    mocks.readCachedYahooQuotes.mockResolvedValue(new Map([["BRL=X", {
      quote: {
        requestedSymbol: "BRL=X",
        symbol: "BRL=X",
        name: "USD/BRL",
        price: 5.25,
        currency: "BRL",
        exchange: "CCY",
        quoteType: "CURRENCY",
        logoUrl: null,
        asOf: new Date("2026-08-03T11:50:00.000Z"),
      },
      cachedAt: new Date("2026-08-03T11:55:00.000Z"),
    }]]));

    const result = await resolveCurrentFinancialFx({ currencyCode: "USD", now });

    expect(result?.rateToBrl.toString()).toBe("5.25");
    expect(result?.source).toBe("YAHOO");
    expect(mocks.fetchYahooFxRates).not.toHaveBeenCalled();
  });

  it("exige fallback quando não existe cotação atual utilizável", async () => {
    const result = await resolveCurrentFinancialFx({ currencyCode: "USD" });
    expect(result).toBeNull();
    expect(mocks.fetchYahooFxRates).toHaveBeenCalledWith(expect.objectContaining({
      currencies: ["USD"],
      cacheMode: "REFRESH",
    }));
  });

  it("aceita cotação corrente manual como fallback substituível", async () => {
    const result = await resolveCurrentFinancialFx({
      currencyCode: "USD",
      manualRateToBrl: 5.4,
      now: new Date("2026-08-03T12:00:00.000Z"),
    });
    expect(result?.rateToBrl.toString()).toBe("5.4");
    expect(result?.source).toBe("MANUAL");
    expect(mocks.fetchYahooFxRates).not.toHaveBeenCalled();
  });

  it("preserva definitivamente a taxa histórica da mesma data", async () => {
    const result = await resolveHistoricalFinancialFx({
      currencyCode: "USD",
      transactionDate: new Date("2026-08-03T12:00:00.000Z"),
      existing: {
        currencyCode: "USD",
        rateToBrl: new Prisma.Decimal("5.31"),
        rateDate: new Date("2026-08-03T00:00:00.000Z"),
        source: "MANUAL",
      },
    });
    expect(result?.rateToBrl.toString()).toBe("5.31");
    expect(result?.source).toBe("MANUAL");
    expect(mocks.ensureHistoricalFxRates).not.toHaveBeenCalled();
  });

  it("usa o último fechamento histórico retornado para a transação", async () => {
    mocks.ensureHistoricalFxRates.mockResolvedValue(new Map([["2026-08-03", {
      rateDate: new Date("2026-07-31T00:00:00.000Z"),
      rateToBrl: new Prisma.Decimal("5.28"),
    }]]));
    const result = await resolveHistoricalFinancialFx({
      currencyCode: "USD",
      transactionDate: new Date("2026-08-03T12:00:00.000Z"),
    });
    expect(result?.rateToBrl.toString()).toBe("5.28");
    expect(result?.rateDate.toISOString().slice(0, 10)).toBe("2026-07-31");
    expect(result?.source).toBe("YAHOO");
  });
});
