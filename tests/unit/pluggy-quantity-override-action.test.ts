import { Prisma } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    pluggyInvestmentDiagramLink: { findFirst: vi.fn(), update: vi.fn() },
    assetHolding: { update: vi.fn() },
    assetCatalogItem: { findUnique: vi.fn() },
  },
  requireUserId: vi.fn(),
  assertUserOperationRateLimit: vi.fn(),
  withUserOperationLease: vi.fn(),
  reconcile: vi.fn(),
  invalidate: vi.fn(),
  revalidatePath: vi.fn(),
  brapiCache: vi.fn(), brapiFetch: vi.fn(), requireBrapiCredentials: vi.fn(),
  yahooCache: vi.fn(), yahooFetch: vi.fn(), yahooFx: vi.fn(),
  insideTransaction: false,
}));

vi.mock("@/lib/prisma", () => ({ prisma: { pluggyInvestmentDiagramLink: mocks.tx.pluggyInvestmentDiagramLink } }));
vi.mock("@/lib/current-user", () => ({ requireUserId: mocks.requireUserId }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/operation-security", () => ({
  assertUserOperationRateLimit: mocks.assertUserOperationRateLimit,
  withUserOperationLease: mocks.withUserOperationLease,
  OperationInProgressError: class extends Error {},
}));
vi.mock("@/features/portfolio/invalidation", () => ({ bumpPortfolioAndInvalidateDrafts: mocks.invalidate }));
vi.mock("@/features/open-finance/diagram-sync", () => ({ reconcilePluggyInvestmentsForUser: mocks.reconcile }));
vi.mock("@/features/open-finance/disconnection", () => ({
  markPluggyItemDisconnected: vi.fn(), resolvePluggyItemDisconnection: vi.fn(),
}));
vi.mock("@/features/open-finance/pluggy", () => ({ deletePluggyItem: vi.fn(), PluggyApiError: class extends Error {} }));
vi.mock("@/features/open-finance/pluggy-credentials", () => ({ requirePluggyCredentials: vi.fn() }));
vi.mock("@/features/portfolio/brapi", () => ({
  readCachedBrapiQuotes: mocks.brapiCache,
  fetchBrapiQuotes: mocks.brapiFetch,
  normalizeBrapiSymbol: (value: string) => value.trim().toUpperCase(),
}));
vi.mock("@/features/portfolio/brapi-credentials", () => ({ requireBrapiCredentials: mocks.requireBrapiCredentials }));
vi.mock("@/features/portfolio/yahoo-finance", () => ({
  readCachedYahooQuotes: mocks.yahooCache,
  fetchYahooQuotes: mocks.yahooFetch,
  fetchYahooFxRates: mocks.yahooFx,
  normalizeYahooSymbol: (value: string) => value.trim().toUpperCase(),
}));

import { resolvePluggyQuantityChangeAction, savePluggyInvestmentMetadataOverridesAction } from "@/features/open-finance/diagram-actions";
import { canEditPluggyInvestmentQuantity, effectivePluggyQuantity } from "@/features/open-finance/investment-quantity-override";

function input(quantity?: { mode: "PROVIDER" | "CUSTOM"; value: number | null }) {
  return {
    linkId: "cmrzcyi3305pglw710ptyacct",
    expectedUpdatedAt: "2026-10-14T10:00:00Z",
    productName: { mode: "PROVIDER" as const, value: null },
    issuer: { mode: "PROVIDER" as const, value: null },
    productType: { mode: "PROVIDER" as const, catalogItemId: null, customTypeName: null },
    rateTerms: { mode: "PROVIDER" as const, rateConvention: null, benchmark: null, rateValue: null },
    purchaseDate: { mode: "PROVIDER" as const, value: null },
    maturityDate: { mode: "PROVIDER" as const, value: null },
    ...(quantity ? { quantity } : {}),
  };
}

function fixture() {
  return {
    id: "cmrzcyi3305pglw710ptyacct",
    userId: "user-a",
    status: "MAPPED",
    updatedAt: new Date("2026-10-14T10:00:00Z"),
    metadataOverrideFields: [] as string[],
    contributionBatches: [],
    overrideQuantity: null as Prisma.Decimal | null,
    overrideQuantityProviderQuantity: null as Prisma.Decimal | null,
    overrideQuantityAcknowledgedAt: null as Date | null,
    investment: {
      source: "INVESTMENTS_API",
      providerAvailable: true,
      quantity: new Prisma.Decimal(0),
      status: "TOTAL_WITHDRAWAL",
      purchaseDate: null,
      dueDate: null,
      item: { userId: "user-a", status: "UPDATED", disconnectedAt: null as Date | null },
    },
    holding: {
      id: "holding-a",
      assetId: "asset-a",
      positionSource: "PLUGGY",
      pricingSource: "BRAPI",
      unitPrice: new Prisma.Decimal("54.92"),
      priceUpdatedAt: new Date("2026-10-14T09:00:00Z") as Date | null,
      currency: "BRL",
      fxRateToBrl: null as Prisma.Decimal | null,
      fxUpdatedAt: null,
      fractional: false,
      asset: {
        portfolioId: "portfolio-a",
        instrumentType: "STOCK",
        investmentClass: "BRAZILIAN_STOCKS",
        ticker: "ITUB3",
        fixedIncomeFamilyCode: null,
        portfolio: { userId: "user-a" },
        holdings: [],
      },
    },
  };
}

describe("quantidade temporária de investimentos Pluggy", () => {
  let link: ReturnType<typeof fixture>;

  beforeEach(() => {
    vi.clearAllMocks();
    link = fixture();
    mocks.requireUserId.mockResolvedValue("user-a");
    mocks.assertUserOperationRateLimit.mockResolvedValue(undefined);
    mocks.tx.pluggyInvestmentDiagramLink.findFirst.mockImplementation(async () => link);
    mocks.withUserOperationLease.mockImplementation(async ({ action }) => action({
      runFencedTransaction: async (operation: (tx: typeof mocks.tx) => unknown) => {
        mocks.insideTransaction = true;
        try { return await operation(mocks.tx); } finally { mocks.insideTransaction = false; }
      },
    }));
    mocks.reconcile.mockResolvedValue({ changed: true });
    mocks.brapiCache.mockResolvedValue(new Map());
    mocks.yahooCache.mockResolvedValue(new Map());
    mocks.brapiFetch.mockResolvedValue([]);
    mocks.yahooFetch.mockResolvedValue([]);
    mocks.yahooFx.mockResolvedValue([]);
    mocks.requireBrapiCredentials.mockResolvedValue({ apiKey: "individual-key", plan: "PRO" });
  });

  it("persiste a quantidade sem alterar o snapshot bruto nem as operações", async () => {
    await savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 110 }));
    const saved = mocks.tx.pluggyInvestmentDiagramLink.update.mock.calls[0][0].data;
    expect(saved.metadataOverrideFields.set).toEqual(["QUANTITY"]);
    expect(saved.overrideQuantity.toString()).toBe("110");
    expect(saved.overrideQuantityProviderQuantity.toString()).toBe("0");
    expect(saved.overrideQuantityAcknowledgedAt).toBeInstanceOf(Date);
    expect(link.investment.quantity.toString()).toBe("0");
    expect(link.investment.status).toBe("TOTAL_WITHDRAWAL");
    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(mocks.withUserOperationLease).toHaveBeenCalledWith(expect.objectContaining({ operation: "pluggy-sync" }));
    expect(mocks.brapiCache).not.toHaveBeenCalled();
    expect(mocks.brapiFetch).not.toHaveBeenCalled();
    expect(mocks.yahooCache).not.toHaveBeenCalled();
    expect(mocks.yahooFetch).not.toHaveBeenCalled();
    expect(mocks.yahooFx).not.toHaveBeenCalled();
  });

  it("preserva a correção quando um cliente antigo omite o campo", async () => {
    link.metadataOverrideFields = ["QUANTITY"];
    link.overrideQuantity = new Prisma.Decimal(110);
    await savePluggyInvestmentMetadataOverridesAction(input());
    const saved = mocks.tx.pluggyInvestmentDiagramLink.update.mock.calls[0][0].data;
    expect(saved.metadataOverrideFields.set).toEqual(["QUANTITY"]);
    expect(saved).not.toHaveProperty("overrideQuantity");
  });

  it("restaura a quantidade da instituição explicitamente", async () => {
    link.metadataOverrideFields = ["QUANTITY"];
    link.overrideQuantity = new Prisma.Decimal(110);
    await savePluggyInvestmentMetadataOverridesAction(input({ mode: "PROVIDER", value: null }));
    const saved = mocks.tx.pluggyInvestmentDiagramLink.update.mock.calls[0][0].data;
    expect(saved.metadataOverrideFields.set).toEqual([]);
    expect(saved.overrideQuantity).toBeNull();
  });

  it.each(["unavailable", "excluded", "disconnected"])("permite restaurar %s sem reativar a posição", async (state) => {
    link.metadataOverrideFields = ["QUANTITY"];
    link.overrideQuantity = new Prisma.Decimal(110);
    if (state === "unavailable") link.investment.providerAvailable = false;
    if (state === "excluded") link.status = "EXCLUDED";
    if (state === "disconnected") link.investment.item.disconnectedAt = new Date();
    await savePluggyInvestmentMetadataOverridesAction(input({ mode: "PROVIDER", value: null }));
    expect(mocks.tx.assetHolding.update).toHaveBeenCalledWith({
      where: { id: "holding-a" },
      data: { quantity: new Prisma.Decimal(0), includedInTotals: false },
    });
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });

  it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e15 + 1, 0.00000000001])("rejeita quantidade inválida %s", async (value) => {
    await expect(savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value }))).rejects.toThrow();
    expect(mocks.tx.pluggyInvestmentDiagramLink.update).not.toHaveBeenCalled();
  });

  it("rejeita frações em posições que só aceitam unidades inteiras", async () => {
    await expect(savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 1.5 }))).rejects.toThrow("inteiras");
  });

  it("aceita até dez casas decimais em posição fracionária", async () => {
    link.holding.fractional = false;
    link.holding.pricingSource = "YAHOO";
    link.holding.asset.investmentClass = "INTERNATIONAL_STOCKS";
    await savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 1.1234567891 }));
    expect(mocks.tx.pluggyInvestmentDiagramLink.update.mock.calls[0][0].data.overrideQuantity.toString()).toBe("1.1234567891");
  });

  it("rejeita preço indisponível depois de tentar recuperação direcionada", async () => {
    link.holding.unitPrice = new Prisma.Decimal(0);
    await expect(savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 110 }))).rejects.toThrow("obter uma cotação válida");
    expect(mocks.brapiFetch).toHaveBeenCalledWith(expect.objectContaining({ tickers: ["ITUB3"], apiKey: "individual-key", plan: "PRO" }));
    expect(mocks.tx.pluggyInvestmentDiagramLink.update).not.toHaveBeenCalled();
  });

  it("exige câmbio válido para preço em moeda estrangeira", async () => {
    link.holding.currency = "USD";
    await expect(savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 110 }))).rejects.toThrow("câmbio válido");
  });

  it("permite zero sem cotação ou câmbio", async () => {
    link.holding.unitPrice = new Prisma.Decimal(0);
    link.holding.currency = "USD";
    await savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 0 }));
    expect(mocks.tx.pluggyInvestmentDiagramLink.update.mock.calls[0][0].data.overrideQuantity.toString()).toBe("0");
    expect(mocks.brapiCache).not.toHaveBeenCalled();
    expect(mocks.brapiFetch).not.toHaveBeenCalled();
    expect(mocks.yahooFx).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "excluded", "review", "disconnected", "deleted", "synthetic", "fixed-income"])("bloqueia correção para %s", async (state) => {
    if (state === "unavailable") link.investment.providerAvailable = false;
    if (state === "excluded") link.status = "EXCLUDED";
    if (state === "review") link.status = "NEEDS_REVIEW";
    if (state === "disconnected") link.investment.item.disconnectedAt = new Date();
    if (state === "deleted") link.investment.item.status = "DELETED";
    if (state === "synthetic") link.investment.source = "ACCOUNT_RESERVED_BALANCE";
    if (state === "fixed-income") link.holding.asset.instrumentType = "FIXED_INCOME";
    await expect(savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 110 }))).rejects.toThrow("conexão ativa");
    expect(mocks.tx.pluggyInvestmentDiagramLink.update).not.toHaveBeenCalled();
  });

  it("bloqueia gravação baseada em versão antiga", async () => {
    link.updatedAt = new Date("2026-10-14T11:00:00Z");
    await expect(savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 110 }))).rejects.toThrow("Reabra a edição");
  });

  it("bloqueia vínculo pertencente a outro usuário", async () => {
    link.investment.item.userId = "user-b";
    await expect(savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 110 }))).rejects.toThrow("não encontrado");
    expect(mocks.requireBrapiCredentials).not.toHaveBeenCalled();
    expect(mocks.brapiCache).not.toHaveBeenCalled();
    expect(mocks.brapiFetch).not.toHaveBeenCalled();
    expect(mocks.yahooFetch).not.toHaveBeenCalled();
  });

  it("rejeita fração BRAPI mesmo quando a flag antiga permite frações", async () => {
    link.holding.fractional = true;
    await expect(savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 1.5 }))).rejects.toThrow("inteiras");
    expect(mocks.brapiCache).not.toHaveBeenCalled();
  });

  it("recupera preço do cache compartilhado com a chave individual", async () => {
    link.holding.unitPrice = new Prisma.Decimal(0);
    mocks.brapiCache.mockResolvedValue(new Map([["ITUB3", {
      quote: { requestedSymbol: "ITUB3", price: 55, currency: "BRL", asOf: new Date("2026-10-14T11:00:00Z") },
    }]]));
    await savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 110 }));
    expect(mocks.requireBrapiCredentials).toHaveBeenCalledWith("user-a");
    expect(mocks.brapiCache).toHaveBeenCalledWith(["ITUB3"]);
    expect(mocks.brapiFetch).not.toHaveBeenCalled();
    expect(mocks.tx.assetHolding.update.mock.calls[0][0].data.unitPrice.toString()).toBe("55");
  });

  it("recupera apenas o ticker da posição fora da transação SQL", async () => {
    link.holding.priceUpdatedAt = null;
    mocks.brapiFetch.mockImplementation(async () => {
      expect(mocks.insideTransaction).toBe(false);
      return [{ requestedSymbol: "ITUB3", price: 56, currency: "BRL", asOf: new Date("2026-10-14T11:00:00Z") }];
    });
    await savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 110 }));
    expect(mocks.brapiFetch).toHaveBeenCalledWith(expect.objectContaining({ tickers: ["ITUB3"] }));
    expect(mocks.tx.assetHolding.update.mock.calls[0][0].data.unitPrice.toString()).toBe("56");
  });

  it("não usa cache brapi sem chave individual", async () => {
    link.holding.unitPrice = new Prisma.Decimal(0);
    mocks.requireBrapiCredentials.mockRejectedValue(new Error("Configure sua chave da brapi"));
    await expect(savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 110 }))).rejects.toThrow("Configure sua chave");
    expect(mocks.brapiCache).not.toHaveBeenCalled();
  });

  it("recupera Yahoo e câmbio sem alterar metadados ou consultar brapi", async () => {
    link.holding.unitPrice = new Prisma.Decimal(0);
    link.holding.pricingSource = "YAHOO";
    link.holding.asset.investmentClass = "INTERNATIONAL_STOCKS";
    link.holding.asset.ticker = "KO";
    mocks.yahooFetch.mockResolvedValue([{ requestedSymbol: "KO", price: 70, currency: "USD", asOf: new Date("2026-10-14T11:00:00Z") }]);
    mocks.yahooFx.mockResolvedValue([{ currency: "USD", rateToBrl: 5.25, asOf: new Date("2026-10-14T11:00:00Z") }]);
    await savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 1.5 }));
    expect(mocks.yahooFetch).toHaveBeenCalledWith(expect.objectContaining({ symbols: ["KO"] }));
    expect(mocks.yahooFx).toHaveBeenCalledWith(expect.objectContaining({ currencies: ["USD"] }));
    const data = mocks.tx.assetHolding.update.mock.calls[0][0].data;
    expect(data.currency).toBe("USD");
    expect(data.fxRateToBrl.toString()).toBe("5.25");
    expect(data).not.toHaveProperty("logoUrl");
    expect(data).not.toHaveProperty("productName");
    expect(mocks.brapiFetch).not.toHaveBeenCalled();
  });

  it("revalida a versão após recuperar cotação", async () => {
    link.holding.unitPrice = new Prisma.Decimal(0);
    mocks.brapiFetch.mockImplementation(async () => {
      link.updatedAt = new Date("2026-10-14T11:00:00Z");
      return [{ requestedSymbol: "ITUB3", price: 56, currency: "BRL", asOf: new Date("2026-10-14T11:00:00Z") }];
    });
    await expect(savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 110 }))).rejects.toThrow("Reabra a edição");
    expect(mocks.tx.pluggyInvestmentDiagramLink.update).not.toHaveBeenCalled();
    expect(mocks.tx.assetHolding.update).not.toHaveBeenCalled();
  });

  it("resolve zero personalizado sem voltar à quantidade do provedor", () => {
    expect(effectivePluggyQuantity(new Prisma.Decimal(110), {
      metadataOverrideFields: ["QUANTITY"], overrideQuantity: new Prisma.Decimal(0),
    }).toString()).toBe("0");
    expect(canEditPluggyInvestmentQuantity({ link, investment: link.investment, holding: link.holding })).toBe(true);
    expect(canEditPluggyInvestmentQuantity({ link, investment: { providerAvailable: true }, holding: link.holding })).toBe(false);
  });

  function reviewInput(decision: "KEEP_MANUAL" | "PROVIDER" = "KEEP_MANUAL") {
    link.metadataOverrideFields = ["QUANTITY", "ISSUER"];
    link.overrideQuantity = new Prisma.Decimal(110);
    link.overrideQuantityProviderQuantity = new Prisma.Decimal(0);
    link.overrideQuantityAcknowledgedAt = new Date("2026-10-14T09:00:00Z");
    link.investment.quantity = new Prisma.Decimal(120);
    return {
      linkId: link.id,
      expectedUpdatedAt: link.updatedAt.toISOString(),
      expectedProviderQuantity: "120",
      decision,
    };
  }

  it("reconhece a nova quantidade ao manter o manual sem alterar valores nem outras correções", async () => {
    expect(await resolvePluggyQuantityChangeAction(reviewInput())).toEqual({ status: "SAVED" });
    const data = mocks.tx.pluggyInvestmentDiagramLink.update.mock.calls[0][0].data;
    expect(data.overrideQuantityProviderQuantity.toString()).toBe("120");
    expect(data.overrideQuantityAcknowledgedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty("overrideQuantity");
    expect(data).not.toHaveProperty("metadataOverrideFields");
    expect(mocks.tx.assetHolding.update).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.brapiFetch).not.toHaveBeenCalled();
  });

  it("volta ao provedor removendo apenas a correção da quantidade", async () => {
    expect(await resolvePluggyQuantityChangeAction(reviewInput("PROVIDER"))).toEqual({ status: "SAVED" });
    const data = mocks.tx.pluggyInvestmentDiagramLink.update.mock.calls[0][0].data;
    expect(data.metadataOverrideFields.set).toEqual(["ISSUER"]);
    expect(data.overrideQuantity).toBeNull();
    expect(data.overrideQuantityProviderQuantity).toBeNull();
    expect(data.overrideQuantityAcknowledgedAt).toBeNull();
    expect(data).not.toHaveProperty("overrideIssuer");
    expect(mocks.reconcile).toHaveBeenCalledOnce();
  });

  it.each(["version", "quantity", "null"])("rejeita decisão antiga: %s", async (conflict) => {
    const payload = reviewInput();
    if (conflict === "version") link.updatedAt = new Date("2026-10-14T11:00:00Z");
    if (conflict === "quantity") link.investment.quantity = new Prisma.Decimal(130);
    const result = await resolvePluggyQuantityChangeAction({ ...payload, expectedProviderQuantity: conflict === "null" ? null : "120" });
    expect(result).toEqual({ status: "CONFLICT" });
    expect(mocks.tx.pluggyInvestmentDiagramLink.update).not.toHaveBeenCalled();
  });

  it.each(["link", "item", "portfolio"])("rejeita acesso cruzado por %s", async (owner) => {
    const payload = reviewInput();
    if (owner === "link") link.userId = "user-b";
    if (owner === "item") link.investment.item.userId = "user-b";
    if (owner === "portfolio") link.holding.asset.portfolio.userId = "user-b";
    expect(await resolvePluggyQuantityChangeAction(payload)).toEqual({ status: "NOT_FOUND" });
    expect(mocks.tx.pluggyInvestmentDiagramLink.update).not.toHaveBeenCalled();
  });

  it.each(["excluded", "unavailable", "disconnected", "restored", "acknowledged"])("não aplica decisão indisponível: %s", async (state) => {
    const payload = reviewInput();
    if (state === "excluded") link.status = "EXCLUDED";
    if (state === "unavailable") link.investment.providerAvailable = false;
    if (state === "disconnected") link.investment.item.disconnectedAt = new Date();
    if (state === "restored") link.metadataOverrideFields = ["ISSUER"];
    if (state === "acknowledged") link.overrideQuantityProviderQuantity = new Prisma.Decimal(120);
    expect(await resolvePluggyQuantityChangeAction(payload)).toEqual({ status: "UNAVAILABLE" });
    expect(mocks.tx.pluggyInvestmentDiagramLink.update).not.toHaveBeenCalled();
  });

  it("não reconhece silenciosamente uma mudança ao salvar a mesma quantidade manual", async () => {
    reviewInput();
    await savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 110 }));
    const data = mocks.tx.pluggyInvestmentDiagramLink.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("overrideQuantityProviderQuantity");
    expect(data).not.toHaveProperty("overrideQuantityAcknowledgedAt");
  });

  it("reconhece a instituição quando o usuário altera explicitamente a quantidade manual", async () => {
    reviewInput();
    await savePluggyInvestmentMetadataOverridesAction(input({ mode: "CUSTOM", value: 115 }));
    const data = mocks.tx.pluggyInvestmentDiagramLink.update.mock.calls[0][0].data;
    expect(data.overrideQuantity.toString()).toBe("115");
    expect(data.overrideQuantityProviderQuantity.toString()).toBe("120");
  });
});
