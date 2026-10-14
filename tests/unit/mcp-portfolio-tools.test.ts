import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analysisHoldingValuation, portfolioTools } from "@/features/mcp/portfolio-tools";
import type { McpContext } from "@/features/mcp/types";

const database = vi.hoisted(() => ({
  portfolio: { findUnique: vi.fn() },
  asset: { findMany: vi.fn(), findFirst: vi.fn() },
  assetHolding: { findMany: vi.fn(), findFirst: vi.fn() },
  investmentTarget: { findMany: vi.fn() },
  pluggyInvestmentDiagramLink: { count: vi.fn() },
  binanceWalletAsset: { count: vi.fn() },
  financialAccount: { findFirst: vi.fn() },
  diagramQuestion: { findMany: vi.fn() },
  assetQuestionAnswer: { findMany: vi.fn() },
  pluggyInvestmentTransaction: { findMany: vi.fn(), findFirst: vi.fn() },
  pluggyInvestment: { findMany: vi.fn(), findFirst: vi.fn() },
  contributionSuggestion: { findMany: vi.fn(), findFirst: vi.fn() },
  pluggyItem: { findMany: vi.fn() },
  binanceConnection: { findUnique: vi.fn() },
}));

vi.mock("@/features/mcp/query", () => ({
  readAnalysis: (_context: McpContext, read: (db: Prisma.TransactionClient) => Promise<unknown>) => read(database as unknown as Prisma.TransactionClient),
}));

const context: McpContext = {
  userId: "current-user", clientId: "analysis-client", grantId: "grant",
  timeZone: "America/Sao_Paulo", scopes: ["portfolio:read"],
};
const date = new Date("2026-10-10T12:00:00.000Z");
const amount = (value: string | number) => new Prisma.Decimal(value);
function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1", ticker: "VIVA3", name: "Vivara", instrumentType: "STOCK",
    investmentClass: "BRAZILIAN_STOCKS", marketRegion: "BRAZIL", fixedIncomeFamilyCode: null,
    indexation: null, score: 8, updatedAt: date, ...overrides,
  };
}
function holding(overrides: Record<string, unknown> = {}) {
  return {
    id: "holding-1", assetId: "asset-1", catalogItemId: null, customTypeName: null,
    issuer: "Vivara", productName: "VIVA3", pricingSource: "BRAPI", positionSource: "MANUAL",
    currency: "BRL", quantity: amount(10), unitPrice: amount(10), fxRateToBrl: null, fxUpdatedAt: null,
    investedValue: null, currentValue: null, providerCurrentValue: null, includedInTotals: true,
    supersededAt: null, fractional: false, rateConvention: null, benchmark: null, rateValue: null,
    purchaseDate: null, maturityDate: null, priceUpdatedAt: date, updatedAt: date,
    catalogItem: null, pluggyDiagramLink: null, binanceWalletAsset: null, ...overrides,
  };
}

async function run(name: string, input: Record<string, unknown> = {}) {
  const tool = portfolioTools.find((tool) => tool.name === name);
  if (!tool) throw new Error(`Tool ${name} is missing`);
  const result = await tool.execute(context, input);
  return result;
}

beforeEach(() => {
  vi.resetAllMocks();
  database.portfolio.findUnique.mockResolvedValue({ id: "portfolio-1", version: 5, updatedAt: date });
  database.asset.findMany.mockResolvedValue([asset()]);
  database.assetHolding.findMany.mockResolvedValue([holding()]);
  database.asset.findFirst.mockResolvedValue(asset());
  database.assetHolding.findFirst.mockResolvedValue({ ...holding(), asset: asset() });
  database.investmentTarget.findMany.mockResolvedValue([{ investmentClass: "BRAZILIAN_STOCKS", percentage: amount(100) }]);
  database.pluggyInvestmentDiagramLink.count.mockResolvedValue(2);
  database.binanceWalletAsset.count.mockResolvedValue(1);
  database.financialAccount.findFirst.mockResolvedValue(null);
  database.diagramQuestion.findMany.mockResolvedValue([]);
  database.assetQuestionAnswer.findMany.mockResolvedValue([]);
  database.pluggyInvestmentTransaction.findMany.mockResolvedValue([]);
  database.pluggyInvestment.findMany.mockResolvedValue([]);
  database.contributionSuggestion.findMany.mockResolvedValue([]);
  database.pluggyItem.findMany.mockResolvedValue([]);
  database.binanceConnection.findUnique.mockResolvedValue(null);
});

describe("read-only MCP portfolio valuation", () => {
  it("keeps USD native amounts separate from converted BRL values", () => {
    const value = analysisHoldingValuation(holding({
      currency: "USD", pricingSource: "YAHOO", quantity: amount(10), unitPrice: amount(20), fxRateToBrl: amount(5),
    }) as Parameters<typeof analysisHoldingValuation>[0]);
    expect(value).toEqual({ nativeValue: "200", valueBrl: "1000", valueSource: "MARKET_PRICE", issue: null });
  });

  it("does not pretend a missing USD conversion is zero", async () => {
    database.assetHolding.findMany.mockResolvedValue([holding({ currency: "USD", pricingSource: "YAHOO" })]);
    const result = await run("get_portfolio_summary");
    expect(result.totalValueBrl).toBeNull();
    expect(result.knownSubtotalBrl).toBe("0");
    expect(result.complete).toBe(false);
    expect(result.valuationIssues).toEqual([{ holdingId: "holding-1", assetId: "asset-1", issue: "MISSING_FX" }]);
  });

  it("distinguishes a missing market quote from zero balance", () => {
    const value = analysisHoldingValuation(holding({ unitPrice: amount(0), providerCurrentValue: amount(0) }) as Parameters<typeof analysisHoldingValuation>[0]);
    expect(value.valueBrl).toBeNull();
    expect(value.issue).toBe("MISSING_QUOTE");
  });

  it("uses a valid provider snapshot as an explicit fallback", () => {
    const value = analysisHoldingValuation(holding({ unitPrice: amount(0), providerCurrentValue: amount("123.45") }) as Parameters<typeof analysisHoldingValuation>[0]);
    expect(value.valueBrl).toBe("123.45");
    expect(value.valueSource).toBe("PROVIDER_SNAPSHOT");
  });

  it("recognizes a confirmed zero foreign balance without needing a quote or conversion", () => {
    const value = analysisHoldingValuation(holding({ currency: "USDT", pricingSource: "BINANCE", quantity: amount(0), unitPrice: amount(0) }) as Parameters<typeof analysisHoldingValuation>[0]);
    expect(value.valueBrl).toBe("0");
    expect(value.issue).toBeNull();
  });

  it("never adds excluded holdings, pending Caixinhas, or unselected Binance assets to totals", async () => {
    database.assetHolding.findMany.mockResolvedValue([holding(), holding({ id: "superseded", includedInTotals: false, currentValue: amount(5_000) })]);
    const result = await run("get_portfolio_summary");
    expect(result.totalValueBrl).toBe("100");
    expect(result.pendingPluggyReview).toBe(2);
    expect(result.unselectedBinanceAssets).toBe(1);
    expect(result.pendingPositionsIncludedInTotals).toBe(false);
    expect(database.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portfolio: { userId: context.userId } } }));
  });
});

describe("MCP portfolio ownership and DTO safety", () => {
  it("identifies temporary quantities without replacing the original provider snapshot", async () => {
    database.assetHolding.findFirst.mockResolvedValue({
      ...holding({
        positionSource: "PLUGGY", quantity: amount(110), providerCurrentValue: amount(0),
        pluggyDiagramLink: {
          id: "link-1", status: "MAPPED", metadataOverrideFields: ["QUANTITY"],
          overrideQuantity: amount(110), metadataOverrideUpdatedAt: date,
          investment: {
            name: "VIVA3", type: "EQUITY", subtype: "STOCK", issuer: null, institutionName: "Inter",
            source: "INVESTMENTS_API", status: "TOTAL_WITHDRAWAL", providerAvailable: true,
            currencyCode: "BRL", balance: amount(0), quantity: amount(0), amountOriginal: null,
            rate: null, rateType: null, fixedAnnualRate: null, annualRate: null,
            purchaseDate: null, dueDate: null, providerUpdatedAt: date, updatedAt: date,
            item: { institutionName: "Inter", connectorName: "MeuPluggy", displayName: null, lastSyncAt: date, syncPending: false },
            _count: { transactions: 2 },
          },
        },
      }), asset: asset(),
    });

    const result = await run("get_holding_details", { holdingId: "holding-1" });
    expect(result.holding).toMatchObject({
      quantity: "110", currentValueBrl: "1100", includedInTotals: true,
      quantityOverride: {
        quantity: "110", providerQuantity: "0", source: "USER_OVERRIDE", restoresAutomatically: false,
      },
      providerMetadata: { quantity: "0", balanceNative: "0", status: "TOTAL_WITHDRAWAL" },
    });
  });

  it("rejects unavailable positions without returning another user's record", async () => {
    database.assetHolding.findFirst.mockResolvedValue(null);
    await expect(run("get_holding_details", { holdingId: "foreign-holding" })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(database.assetHolding.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign-holding", asset: { portfolio: { userId: context.userId } } } }));
  });

  it("separates effective user terms from original provider values and never selects identity/raw fields", async () => {
    database.assetHolding.findFirst.mockResolvedValue({
      ...holding({
        positionSource: "PLUGGY", productName: "Corrected CDB", issuer: "Corrected issuer", rateValue: amount("14.85"),
        rateConvention: "FIXED_ANNUAL", pluggyDiagramLink: {
          id: "link-1", status: "MAPPED", metadataOverrideFields: ["PRODUCT_NAME", "RATE_TERMS"], metadataOverrideUpdatedAt: date,
          investment: {
            name: "Provider CDB", type: "FIXED_INCOME", subtype: "CDB", issuer: "Provider issuer", institutionName: "XP",
            source: "INVESTMENTS_API", status: "ACTIVE", providerAvailable: true, currencyCode: "BRL", balance: amount(100),
            quantity: amount(1), amountOriginal: amount(90), rate: amount("8.95"), rateType: "ANNUAL", fixedAnnualRate: amount("8.95"), annualRate: null,
            purchaseDate: null, dueDate: null, providerUpdatedAt: date, updatedAt: date,
            item: { institutionName: "XP", connectorName: "XP", displayName: null, lastSyncAt: date, syncPending: false },
            _count: { transactions: 3 },
          },
        },
      }), asset: asset(),
    });
    const result = await run("get_holding_details", { holdingId: "holding-1" });
    const dto = result.holding as Record<string, unknown>;
    expect(dto.effectiveMetadata).toMatchObject({ productName: "Corrected CDB", issuer: "Corrected issuer", rateValue: "14.85" });
    expect(dto.providerMetadata).toMatchObject({ productName: "Provider CDB", rate: "8.95" });
    expect(dto.overrideFields).toEqual(["PRODUCT_NAME", "RATE_TERMS"]);
    const query = JSON.stringify(database.assetHolding.findFirst.mock.calls);
    expect(query).not.toContain("issuerCnpj");
    expect(query).not.toContain('"metadata":true');
    expect(query).not.toContain("pluggyInvestmentId");
  });

  it("redacts incidental CPF in labels and marks imported operation coverage", async () => {
    database.assetHolding.findFirst.mockResolvedValue({ ...holding({ issuer: "Name 123.456.789-01", productName: "12345678901" }), asset: asset({ name: "CPF 123.456.789-01" }) });
    const result = await run("get_holding_details", { holdingId: "holding-1" });
    expect(JSON.stringify(result)).not.toContain("123.456.789-01");
    expect(JSON.stringify(result)).not.toContain("12345678901");
    expect(result.holding).toMatchObject({ operationHistoryWarning: expect.stringContaining("incomplete") });
  });

  it("bounds pages and validates owned cursor IDs before reading a page", async () => {
    await expect(run("list_holdings", { limit: 101 })).rejects.toThrow();
    database.assetHolding.findFirst.mockResolvedValue(null);
    await expect(run("list_holdings", { cursor: "foreign-cursor" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reads unanswered existing questions without creating defaults", async () => {
    database.diagramQuestion.findMany.mockResolvedValue([{ id: "question-1", type: "CERRADO", criterion: "Growth", text: "Has durable growth?", active: true, sortOrder: 0 }]);
    const result = await run("get_investment_thesis", { assetId: "asset-1" });
    expect(result.questions).toEqual([{ id: "question-1", type: "CERRADO", criterion: "Growth", text: "Has durable growth?", active: true, sortOrder: 0, answer: null }]);
    expect(database.diagramQuestion.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("non-saving MCP aporte preview", () => {
  it("preserves currency-scope caps against the full portfolio", async () => {
    database.asset.findMany.mockResolvedValue([asset(), asset({ id: "fixed", ticker: "CDB", instrumentType: "FIXED_INCOME", investmentClass: "FIXED_INCOME", score: 0 })]);
    database.assetHolding.findMany.mockResolvedValue([holding(), holding({ id: "fixed-holding", assetId: "fixed", pricingSource: "MANUAL", quantity: amount(0), unitPrice: amount(0), currentValue: amount(900) })]);
    database.investmentTarget.findMany.mockResolvedValue([{ investmentClass: "BRAZILIAN_STOCKS", percentage: amount(50) }, { investmentClass: "FIXED_INCOME", percentage: amount(50) }]);
    const result = await run("preview_contribution", { amount: "1500", currency: "BRL", allocationScope: "BRL_ONLY" });
    expect(result.status).toBe("PREVIEW");
    expect(result.saved).toBe(false);
    expect(result.executed).toBe(false);
    const suggestions = result.suggestions as Array<Record<string, unknown>>;
    expect(suggestions).toHaveLength(1);
    expect(Number(suggestions[0].valueBrl)).toBeLessThanOrEqual(800);
    expect(Number(suggestions[0].totalAfterSuggestionPercentage)).toBeLessThanOrEqual(50);
    expect(Number(result.unallocatedAmountBrl)).toBeGreaterThanOrEqual(700);
    // The fake transaction contains read methods only; any attempted persistence or provider action fails this test.
  });

  it("uses stored USD FX and supports fractional international stock quantities", async () => {
    database.asset.findMany.mockResolvedValue([asset({ ticker: "KO", investmentClass: "INTERNATIONAL_STOCKS", marketRegion: "INTERNATIONAL" })]);
    database.assetHolding.findMany.mockResolvedValue([holding({ currency: "USD", pricingSource: "YAHOO", unitPrice: amount(100), quantity: amount(1), fxRateToBrl: amount(5), fxUpdatedAt: date })]);
    database.investmentTarget.findMany.mockResolvedValue([{ investmentClass: "INTERNATIONAL_STOCKS", percentage: amount(100) }]);
    const result = await run("preview_contribution", { amount: "150", currency: "USD", allocationScope: "USD_ONLY" });
    expect(result.requestedAmountBrl).toBe("750");
    expect(result.fx).toMatchObject({ rateToBrl: "5", source: "STORED_USD_BRL" });
    expect(result.suggestions).toEqual([expect.objectContaining({ quantity: "1.5", nativeCurrency: "USD", nativeValue: "150", valueBrl: "750" })]);
  });

  it("refuses incomplete valuations and missing stored FX without requesting providers", async () => {
    database.assetHolding.findMany.mockResolvedValue([holding({ currency: "USD", pricingSource: "YAHOO" })]);
    expect(await run("preview_contribution", { amount: "100", currency: "USD" })).toMatchObject({ status: "UNAVAILABLE", saved: false, reason: "INCOMPLETE_PORTFOLIO_VALUATION" });
    database.assetHolding.findMany.mockResolvedValue([holding()]);
    expect(await run("preview_contribution", { amount: "100", currency: "USD" })).toMatchObject({ status: "UNAVAILABLE", saved: false, reason: "MISSING_STORED_USD_BRL_RATE" });
  });

  it("does not revive an excluded provider position", async () => {
    database.assetHolding.findMany.mockResolvedValue([holding({ includedInTotals: false, positionSource: "PLUGGY" })]);
    const result = await run("preview_contribution", { amount: "100", currency: "BRL" });
    expect(result.suggestions).toEqual([]);
    expect(result.unallocatedAmountBrl).toBe("100");
  });
});

describe("operations and freshness", () => {
  it("lists a pending Caixinha separately without adding it to portfolio totals", async () => {
    database.pluggyInvestment.findMany.mockResolvedValue([{
      id: "caixinha", name: "Reserva", type: "OTHER", subtype: null, issuer: null, institutionName: "Mercado Pago",
      source: "ACCOUNT_RESERVED_BALANCE", status: "ACTIVE", providerAvailable: true, currencyCode: "BRL", balance: amount(500),
      quantity: null, amountOriginal: null, rate: amount(100), rateType: "CDI", fixedAnnualRate: null, annualRate: null,
      purchaseDate: null, dueDate: null, providerUpdatedAt: date, updatedAt: date,
      item: { institutionName: "Mercado Pago", connectorName: "MeuPluggy", displayName: null, lastSyncAt: date, syncPending: false },
      _count: { transactions: 0 }, diagramLink: { userId: context.userId, status: "NEEDS_REVIEW", holding: null },
    }]);
    const result = await run("list_connected_investments", { mappingStatus: "NEEDS_REVIEW" });
    expect(result.investments).toEqual([expect.objectContaining({ isCaixinha: true, includedInPortfolioTotals: false, holding: null, providerMetadata: expect.objectContaining({ nativeCurrentValue: "500" }) })]);
    expect(database.pluggyInvestment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { item: { userId: context.userId }, providerAvailable: true, diagramLink: { userId: context.userId, status: "NEEDS_REVIEW" } } }));
  });

  it("keeps imported operations separate from locally recorded aportes", async () => {
    const imported = await run("list_investment_operations", { assetId: "asset-1", source: "IMPORTED", startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(imported.source).toBe("IMPORTED");
    expect(database.contributionSuggestion.findMany).not.toHaveBeenCalled();
    expect(database.pluggyInvestmentTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ investment: expect.objectContaining({ diagramLink: expect.objectContaining({ userId: context.userId }) }) }) }));
    const local = await run("list_investment_operations", { assetId: "asset-1", source: "LOCAL", startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(local.source).toBe("LOCAL");
    expect(database.contributionSuggestion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ simulation: expect.objectContaining({ userId: context.userId }), executionStatus: { in: ["AWAITING_SYNC", "EXECUTED"] } }) }));
  });

  it("rejects invalid or over-12-month operation windows", async () => {
    await expect(run("list_investment_operations", { assetId: "asset-1", startDate: "2025-01-01", endDate: "2026-01-02" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(run("list_investment_operations", { assetId: "asset-1", startDate: "2026-02-30", endDate: "2026-03-01" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("reports stale snapshots without starting any synchronization", async () => {
    database.assetHolding.findMany.mockResolvedValue([{ ...holding(), asset: { ticker: "VIVA3" }, priceUpdatedAt: new Date("2020-01-01T00:00:00Z") }]);
    database.pluggyItem.findMany.mockResolvedValue([{ id: "connection", institutionName: "Inter", connectorName: "Inter", displayName: null, lastSyncAt: null, syncPending: true, status: "UPDATED", disconnectedAt: null }]);
    const result = await run("get_portfolio_data_freshness");
    expect(result.synchronizationRequested).toBe(false);
    expect(result.holdings).toEqual([expect.objectContaining({ marketPriceStale: true })]);
    expect(result.pluggy).toEqual([expect.objectContaining({ stale: true, syncPending: true })]);
  });
});
