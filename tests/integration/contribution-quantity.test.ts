import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient, type InstrumentType, type InvestmentClass } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import { deleteAssetAction, deleteAssetClassAction, executeContributionAction, reviewAwaitingContributionAction, saveAwaitingContributionPriceAction } from "@/features/portfolio/actions";
import { GET as holdingTransactions } from "@/app/api/portfolio/holdings/[holdingId]/transactions/route";
import { getPortfolioData } from "@/features/portfolio/data";
import { getOpenFinanceData } from "@/features/open-finance/data";
import { reconcilePluggyInvestmentsForUser } from "@/features/open-finance/diagram-sync";
import { reviewPluggyDiagramLinkAction, resolvePluggyQuantityChangeAction } from "@/features/open-finance/diagram-actions";
import { markPluggyItemDisconnected, resolvePluggyItemDisconnection } from "@/features/open-finance/disconnection";
import { resolveContributionQuantity } from "@/features/open-finance/contribution-quantity";
import { portfolioTools } from "@/features/mcp/portfolio-tools";

const current = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => current.userId }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const db = process.env.DATABASE_URL ? new PrismaClient() : null;
const suite = db ? describe : describe.skip;

suite("Open Finance contribution quantity reconciliation", () => {
  const users: string[] = [];
  async function fixture(type: InstrumentType = "STOCK", investmentClass: InvestmentClass = "BRAZILIAN_STOCKS", currency = "BRL") {
    const suffix = randomUUID();
    const user = await db!.user.create({ data: { email: `quantity-contribution-${suffix}@example.com`, portfolio: { create: {} } }, include: { portfolio: true } });
    users.push(user.id); current.userId = user.id;
    const ticker = type === "ETF" ? "AUPO11" : "ITUB3";
    const item = await db!.pluggyItem.create({ data: { userId: user.id, pluggyItemId: suffix, connectorName: "Banco teste", status: "UPDATED", syncPending: false } });
    const investment = await db!.pluggyInvestment.create({ data: {
      pluggyItemDbId: item.id, pluggyInvestmentId: suffix, name: ticker, code: ticker,
      type: "EQUITY", subtype: type, quantity: 100, balance: 1000, value: 10, amountOriginal: 1000,
      currencyCode: currency, providerAvailable: true, status: "ACTIVE", providerUpdatedAt: new Date(Date.now() - 60_000),
    } });
    const asset = await db!.asset.create({ data: { portfolioId: user.portfolio!.id, ticker, name: ticker, instrumentType: type, investmentClass, score: 5, marketRegion: currency === "BRL" ? "BRAZIL" : "INTERNATIONAL" } });
    const holding = await db!.assetHolding.create({ data: {
      assetId: asset.id, productName: ticker, issuer: "Banco teste", ticker,
      positionSource: "PLUGGY", pricingSource: type === "FIXED_INCOME" ? "PLUGGY" : currency === "BRL" ? "BRAPI" : "YAHOO",
      quantity: 100, unitPrice: 10, providerCurrentValue: 1000, currentValue: type === "FIXED_INCOME" ? 1000 : null,
      investedValue: 1000, investedValueCurrency: currency, currency,
      fxRateToBrl: currency === "BRL" ? null : 5, fractional: currency !== "BRL", priceUpdatedAt: new Date(),
    } });
    const link = await db!.pluggyInvestmentDiagramLink.create({ data: {
      userId: user.id, pluggyInvestmentDbId: investment.id, assetHoldingId: holding.id,
      status: "MAPPED", classificationSource: "USER_OVERRIDE", suggestedInstrumentType: type, suggestedInvestmentClass: investmentClass,
    } });
    return { user, item, investment, asset, holding, link };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function simulation(f: Fixture, quantity = 10) {
    const portfolio = await db!.portfolio.findUniqueOrThrow({ where: { id: f.user.portfolio!.id } });
    return db!.contributionSimulation.create({ data: {
      userId: f.user.id, portfolioVersion: portfolio.version, allocationMethod: "IMPROVED", calculationVersion: "3",
      inputAmount: quantity * 12, requestedAmount: quantity * 12, unallocatedAmount: 0,
      suggestions: { create: { assetId: f.asset.id, quantity, value: quantity * 12, suggestionPercentage: 100, totalAfterSuggestionPercentage: 100 } },
    }, include: { suggestions: true } });
  }
  async function buy(f: Fixture, quantity = 10, paidPrice = 12) {
    current.userId = f.user.id;
    const s = await simulation(f, quantity);
    const result = await executeContributionAction(s.id, s.suggestions[0].id, quantity, paidPrice, { holdingId: f.holding.id });
    expect(result).toMatchObject({ status: "EXECUTED", awaitingSync: true, quantityProjected: true });
    return s.suggestions[0];
  }
  async function provider(f: Fixture, quantity: number, options: { cost?: number; old?: boolean } = {}) {
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: {
      quantity, balance: quantity * 10, ...(options.cost === undefined ? {} : { amountOriginal: options.cost }),
      providerUpdatedAt: new Date(Date.now() + (options.old ? -120_000 : 1000)),
    } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
  }
  async function position(f: Fixture) { return db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } }); }
  async function decide(f: Fixture, decision: "PROVIDER" | "KEEP_MANUAL") {
    const change = (await getPortfolioData(f.user.id)).quantityChanges[0];
    expect(change).toBeDefined(); current.userId = f.user.id;
    return resolvePluggyQuantityChangeAction({ ...change, expectedProviderQuantity: change.providerQuantity, decision });
  }
  afterAll(async () => { if (db) { await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect(); } });

  it("immediately projects quantity and paid cost in portfolio/MCP without changing raw provider data", async () => {
    const f = await fixture(); await buy(f);
    const holding = await position(f);
    expect(holding.quantity.toString()).toBe("110"); expect(holding.investedValue?.toString()).toBe("1120");
    const raw = await db!.pluggyInvestment.findUniqueOrThrow({ where: { id: f.investment.id } });
    expect(raw.quantity?.toString()).toBe("100"); expect(raw.amountOriginal?.toString()).toBe("1000");
    const portfolio = await getPortfolioData(f.user.id);
    expect(portfolio.assets[0]).toMatchObject({ quantity: "110", currentValue: "1100" });
    expect(Number(portfolio.assets[0].averagePricePaid)).toBeCloseTo(1120 / 110);
    const history = await holdingTransactions(new Request(`http://localhost/api/portfolio/holdings/${f.holding.id}/transactions`), { params: Promise.resolve({ holdingId: f.holding.id }) });
    expect(Number((await history.json()).averagePricePaid)).toBeCloseTo(1120 / 110);
    expect(portfolio.assets[0].awaitingSyncContributions).toHaveLength(1);
    const details = await portfolioTools.find((t) => t.name === "get_holding_details")!.execute({ userId: f.user.id, scopes: ["portfolio:read"], clientId: "test", grantId: "test", timeZone: "America/Sao_Paulo" }, { holdingId: f.holding.id });
    expect(details).toMatchObject({ holding: { quantity: "110", investedValue: "1120", quantityOverride: { source: "CONTRIBUTION", restoresAutomatically: true } } });
  });
  it("accumulates contributions, recognizes a FIFO prefix and resumes autosync on the full match", async () => {
    const f = await fixture(); const first = await buy(f, 10); const second = await buy(f, 5);
    expect((await position(f)).quantity.toString()).toBe("115");
    await provider(f, 100); expect((await position(f)).quantity.toString()).toBe("115");
    await provider(f, 110, { cost: 1120 });
    expect((await position(f)).quantity.toString()).toBe("115"); expect((await position(f)).investedValue?.toString()).toBe("1180");
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: first.id } })).executionStatus).toBe("EXECUTED");
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: second.id } })).executionStatus).toBe("AWAITING_SYNC");
    expect((await getPortfolioData(f.user.id)).quantityChanges).toEqual([]);
    await provider(f, 115, { cost: 1180 });
    expect((await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: f.link.id } })).overrideQuantity).toBeNull();
    await provider(f, 120); expect((await position(f)).quantity.toString()).toBe("120");
  });
  it("preserves mismatches, durably acknowledges keep-mine and automatically recovers later", async () => {
    const f = await fixture(); await buy(f, 15); await provider(f, 112);
    expect((await position(f)).quantity.toString()).toBe("115");
    expect((await getOpenFinanceData(f.user.id)).quantityChanges).toHaveLength(1);
    await expect(decide(f, "KEEP_MANUAL")).resolves.toEqual({ status: "SAVED" });
    await provider(f, 112); expect((await getPortfolioData(f.user.id)).quantityChanges).toEqual([]);
    await provider(f, 113); expect((await getPortfolioData(f.user.id)).quantityChanges).toHaveLength(1);
    await provider(f, 115); expect((await getPortfolioData(f.user.id)).quantityChanges).toEqual([]);
    expect((await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: f.link.id } })).overrideQuantity).toBeNull();
  });
  it("adopts the institution position with an explicit user resolution and preserves recorded quantities", async () => {
    const f = await fixture(); const s = await buy(f, 15); await provider(f, 112);
    await expect(decide(f, "PROVIDER")).resolves.toEqual({ status: "SAVED" });
    expect((await position(f)).quantity.toString()).toBe("112");
    expect(await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ executionStatus: "EXECUTED", syncResolution: "USER_PROVIDER" });
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: s.id } })).quantity.toString()).toBe("15");
  });
  it("starts from a manual correction and preserves unrelated metadata", async () => {
    const f = await fixture(); await db!.pluggyInvestmentDiagramLink.update({ where: { id: f.link.id }, data: {
      metadataOverrideFields: ["QUANTITY", "PRODUCT_NAME"], overrideQuantity: 105, overrideQuantityProviderQuantity: 100,
      overrideQuantityAcknowledgedAt: new Date(), overrideProductName: "Nome meu",
    } });
    await db!.assetHolding.update({ where: { id: f.holding.id }, data: { quantity: 105 } });
    await buy(f, 10); expect((await position(f)).quantity.toString()).toBe("115");
    await provider(f, 115);
    expect((await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: f.link.id } })).metadataOverrideFields).toEqual(["PRODUCT_NAME"]);
  });
  it("applies to a fixed-income ETF but leaves actual fixed-income products awaiting without projection", async () => {
    const etf = await fixture("ETF", "FIXED_INCOME"); await buy(etf); expect((await position(etf)).quantity.toString()).toBe("110");
    const cdb = await fixture("FIXED_INCOME", "FIXED_INCOME"); const s = await simulation(cdb, 500);
    current.userId = cdb.user.id;
    await expect(executeContributionAction(s.id, s.suggestions[0].id, 500, undefined, { holdingId: cdb.holding.id })).resolves.toMatchObject({ awaitingSync: true, quantityProjected: false });
    expect((await position(cdb)).quantity.toString()).toBe("100"); expect((await position(cdb)).currentValue?.toString()).toBe("1000");
    expect(await db!.pluggyContributionBatch.count({ where: { linkId: cdb.link.id } })).toBe(0);
  });
  it("does not accept stale/missing provider quantities or treat quote/FX changes as purchases", async () => {
    const f = await fixture(); await buy(f); await provider(f, 110, { old: true });
    expect((await db!.contributionSuggestion.findFirstOrThrow({ where: { assetId: f.asset.id } })).executionStatus).toBe("AWAITING_SYNC");
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: { quantity: null, balance: 9000, value: 90, providerUpdatedAt: new Date() } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await position(f)).quantity.toString()).toBe("110"); expect((await getPortfolioData(f.user.id)).quantityChanges).toEqual([]);
  });
  it.each([110, 108])("requires explicit review for a timestamp-less quantity of %i", async (quantity) => {
    const f = await fixture();
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: { providerUpdatedAt: null } });
    const s = await buy(f);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await getPortfolioData(f.user.id)).quantityChanges).toEqual([]);
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: { quantity, providerUpdatedAt: null } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await position(f)).quantity.toString()).toBe("110");
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: s.id } })).executionStatus).toBe("AWAITING_SYNC");
    const change = (await getPortfolioData(f.user.id)).quantityChanges[0];
    expect(change?.providerQuantity).toBe(String(quantity));
    await decide(f, "KEEP_MANUAL");
    await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await getPortfolioData(f.user.id)).quantityChanges).toEqual([]);
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: { quantity: quantity + 1, providerUpdatedAt: null } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await getPortfolioData(f.user.id)).quantityChanges).toHaveLength(1);
    await decide(f, "PROVIDER");
    expect((await position(f)).quantity.toString()).toBe(String(quantity + 1));
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: s.id } })).syncResolution).toBe("USER_PROVIDER");
  });
  it("retains the last provider version when acknowledging a timestamp-less snapshot", async () => {
    const f = await fixture(); const s = await buy(f);
    const known = new Date(Date.now() + 60_000);
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: { quantity: 108, providerUpdatedAt: known } });
    await reconcilePluggyInvestmentsForUser(f.user.id); await decide(f, "KEEP_MANUAL");
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: { quantity: 109, providerUpdatedAt: null } });
    await reconcilePluggyInvestmentsForUser(f.user.id); await decide(f, "KEEP_MANUAL");
    expect((await db!.pluggyContributionBatch.findFirstOrThrow({ where: { linkId: f.link.id } })).providerUpdatedAt).toEqual(known);
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: { quantity: 110, providerUpdatedAt: new Date(known.getTime() - 1000) } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: s.id } })).executionStatus).toBe("AWAITING_SYNC");
  });
  it.each(["ASSET", "CLASS"] as const)("retires the contribution projection before %s deletion and allows remapping", async (kind) => {
    const f = await fixture(); await buy(f);
    await db!.pluggyInvestmentDiagramLink.update({ where: { id: f.link.id }, data: {
      metadataOverrideFields: ["QUANTITY", "PRODUCT_NAME"], overrideProductName: "My name",
    } });
    if (kind === "ASSET") await deleteAssetAction(f.asset.id); else await deleteAssetClassAction("BRAZILIAN_STOCKS");
    const link = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: f.link.id }, include: { contributionBatches: true } });
    expect(link.contributionBatches[0].state).toBe("RESOLVED");
    expect(link.overrideQuantity).toBeNull(); expect(link.metadataOverrideFields).toEqual(["PRODUCT_NAME"]);
    expect(link.assetHoldingId).toBeNull();
    await reviewPluggyDiagramLinkAction({ linkId: f.link.id, instrumentType: "STOCK", investmentClass: "BRAZILIAN_STOCKS", score: 5 });
    const mapped = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: f.link.id }, include: { holding: { include: { asset: true } } } });
    expect(mapped.holding!.quantity.toString()).toBe("100");
    const remapped = { ...f, asset: mapped.holding!.asset, holding: mapped.holding! };
    await buy(remapped, 5);
    expect((await position(remapped)).quantity.toString()).toBe("105");
    expect(await db!.pluggyContributionBatch.count({ where: { linkId: f.link.id, state: "WAITING" } })).toBe(1);
  });
  it.each(["MATCH", "PROVIDER"] as const)("restores the reported balance after %s resolution of a provider-priced holding", async (mode) => {
    const f = await fixture("MUTUAL_FUND");
    await db!.assetHolding.update({ where: { id: f.holding.id }, data: { pricingSource: "PLUGGY", fractional: true, currentValue: 1000 } });
    await buy(f);
    expect((await position(f)).currentValue?.toString()).toBe("1100");
    const quantity = mode === "MATCH" ? 110 : 108;
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: { quantity, balance: 1234.56, value: 10, providerUpdatedAt: new Date() } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    if (mode === "PROVIDER") await db!.$transaction((tx) => resolveContributionQuantity(tx, f.link.id, "PROVIDER"));
    const holding = await position(f);
    expect(holding.pricingSource).toBe("PLUGGY");
    expect(holding.currentValue?.toString()).toBe("1234.56");
    expect(holding.quantity.toString()).toBe(String(quantity));
    expect((await getPortfolioData(f.user.id)).assets[0].currentValue).toBe("1234.56");
    expect((await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: f.link.id } })).overrideQuantity).toBeNull();
  });
  it.each(["STOCK", "MUTUAL_FUND"] as const)("keeps drafts valid after an identical pending %s snapshot", async (type) => {
    const f = await fixture(type);
    if (type === "MUTUAL_FUND") await db!.assetHolding.update({ where: { id: f.holding.id }, data: { pricingSource: "PLUGGY", fractional: true, currentValue: 1000 } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    await buy(f);
    const draft = await simulation(f);
    const before = await db!.portfolio.findUniqueOrThrow({ where: { id: f.user.portfolio!.id } });
    for (let i = 0; i < 2; i++) await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await db!.portfolio.findUniqueOrThrow({ where: { id: before.id } })).version).toBe(before.version);
    expect((await db!.contributionSimulation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
    expect((await position(f)).quantity.toString()).toBe("110");
    expect((await position(f)).investedValue?.toString()).toBe("1120");
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: { amountOriginal: 1120, providerUpdatedAt: new Date() } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await position(f)).investedValue?.toString()).toBe("1120");
    expect((await db!.portfolio.findUniqueOrThrow({ where: { id: before.id } })).version).toBe(before.version);
    expect((await db!.contributionSimulation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
    if (type === "MUTUAL_FUND") {
      expect((await position(f)).currentValue?.toString()).toBe("1100");
      await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: { value: 11 } });
      await reconcilePluggyInvestmentsForUser(f.user.id);
      expect((await position(f)).currentValue?.toString()).toBe("1210");
      expect((await db!.contributionSimulation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("STALE");
    }
  });
  it.each([true, false])("initializes legacy cost only from an unchanged pre-registration snapshot (safe=%s)", async (safe) => {
    const f = await fixture(); const s = await simulation(f);
    await db!.contributionSuggestion.update({ where: { id: s.suggestions[0].id }, data: {
      executionStatus: "AWAITING_SYNC", awaitingSyncAt: new Date(Date.now() - (safe ? 1000 : 120_000)), paidUnitPrice: 12,
      externalBaselines: { create: { holdingId: f.holding.id, quantity: 100, providerValue: 1000, currency: "BRL", fxRateToBrl: 1 } },
    } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    const batch = await db!.pluggyContributionBatch.findFirstOrThrow({ where: { linkId: f.link.id } });
    expect(batch.baselineCostNative?.toString() ?? null).toBe(safe ? "1000" : null);
    expect((await position(f)).quantity.toString()).toBe("110");
    expect((await position(f)).investedValue?.toString() ?? null).toBe(safe ? "1120" : null);
    if (safe) {
      expect(Number((await getPortfolioData(f.user.id)).assets[0].averagePricePaid)).toBeCloseTo(1120 / 110);
      const response = await holdingTransactions(new Request(`http://localhost/api/portfolio/holdings/${f.holding.id}/transactions`), { params: Promise.resolve({ holdingId: f.holding.id }) });
      expect(Number((await response.json()).averagePricePaid)).toBeCloseTo(1120 / 110);
    }
  });
  it("requires a destination when multiple institutions hold the same asset", async () => {
    const f = await fixture(); const suffix = randomUUID();
    const other = await db!.assetHolding.create({ data: { ...Object.fromEntries(Object.entries(f.holding).filter(([k]) => !["id", "createdAt", "updatedAt"].includes(k))), assetId: f.asset.id, issuer: "Outro banco", productName: "Outra posição" } as Prisma.AssetHoldingUncheckedCreateInput });
    const investment = await db!.pluggyInvestment.create({ data: { pluggyItemDbId: f.item.id, pluggyInvestmentId: suffix, name: "ITUB3", code: "ITUB3", type: "EQUITY", quantity: 100, balance: 1000, value: 10, status: "ACTIVE" } });
    await db!.pluggyInvestmentDiagramLink.create({ data: { userId: f.user.id, pluggyInvestmentDbId: investment.id, assetHoldingId: other.id, status: "MAPPED" } });
    const s = await simulation(f); await expect(executeContributionAction(s.id, s.suggestions[0].id, 10, 12)).rejects.toThrow("Selecione a posição");
    await buy(f); expect((await db!.assetHolding.findUniqueOrThrow({ where: { id: other.id } })).quantity.toString()).toBe("100");
  });
  it("rejects duplicate execution and another user's destination", async () => {
    const f = await fixture(); const s = await simulation(f);
    await executeContributionAction(s.id, s.suggestions[0].id, 10, 12, { holdingId: f.holding.id });
    await expect(executeContributionAction(s.id, s.suggestions[0].id, 10, 12, { holdingId: f.holding.id })).resolves.toMatchObject({ status: "INVALIDATED" });
    const other = await fixture(); current.userId = f.user.id; const next = await simulation(f);
    await expect(executeContributionAction(next.id, next.suggestions[0].id, 10, 12, { holdingId: other.holding.id })).rejects.toThrow("Selecione a posição");
    expect((await position(f)).quantity.toString()).toBe("110");
  });
  it("rejects stale conflict decisions and new contributions during unresolved conflicts", async () => {
    const f = await fixture(); await buy(f); await provider(f, 108);
    const old = (await getPortfolioData(f.user.id)).quantityChanges[0];
    await provider(f, 107);
    await expect(resolvePluggyQuantityChangeAction({ ...old, expectedProviderQuantity: old.providerQuantity, decision: "PROVIDER" })).resolves.toEqual({ status: "CONFLICT" });
    const s = await simulation(f); await expect(executeContributionAction(s.id, s.suggestions[0].id, 5, 12, { holdingId: f.holding.id })).rejects.toThrow("Resolva a revisão");
  });
  it("materializes the projected position once when keeping a disconnected holding manual", async () => {
    const f = await fixture(); const s = await buy(f); await markPluggyItemDisconnected(f.item.pluggyItemId);
    await resolvePluggyItemDisconnection(f.user.id, f.item.id, "KEEP_MANUAL");
    const holding = await position(f); expect(holding.positionSource).toBe("MANUAL"); expect(holding.quantity.toString()).toBe("110");
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: s.id } })).syncResolution).toBe("DISCONNECTED_MANUAL");
  });
  it("initializes safe historical awaiting entries once without adding an already-synced purchase", async () => {
    const f = await fixture(); const s = await simulation(f);
    await db!.contributionSuggestion.update({ where: { id: s.suggestions[0].id }, data: {
      executionStatus: "AWAITING_SYNC", awaitingSyncAt: new Date(Date.now() - 10_000), baselineQuantity: 100,
      externalBaselines: { create: { holdingId: f.holding.id, quantity: 100, providerValue: 1000, currency: "BRL", fxRateToBrl: 1 } },
    } });
    await provider(f, 110); await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await position(f)).quantity.toString()).toBe("110");
    expect(await db!.pluggyContributionBatch.count({ where: { linkId: f.link.id } })).toBe(1);
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: s.suggestions[0].id } })).syncResolution).toBe("PROVIDER_MATCH");
  });
  it("keeps fractional units at ten decimals and freezes paid FX without freezing market FX", async () => {
    const f = await fixture("STOCK", "INTERNATIONAL_STOCKS", "USD"); const s = await buy(f, 0.1234567891, 12);
    expect((await position(f)).quantity.toString()).toBe("100.1234567891");
    await db!.assetHolding.update({ where: { id: f.holding.id }, data: { fxRateToBrl: 6, unitPrice: 11 } });
    const asset = (await getPortfolioData(f.user.id)).assets[0];
    expect(Number(asset.currentValue)).toBeCloseTo(100.1234567891 * 11 * 6);
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: s.id } })).executionFxRateToBrl?.toString()).toBe("5");
  });
  it("does not confirm or duplicate cost when BUY transactions arrive before the provider quantity", async () => {
    const f = await fixture(); const s = await buy(f, 10, 12);
    await db!.pluggyInvestmentTransaction.create({ data: {
      pluggyInvestmentDbId: f.investment.id, pluggyInvestmentTransactionId: randomUUID(),
      type: "BUY", quantity: 10, value: 12, amount: 120, date: new Date(),
    } });
    await provider(f, 100, { cost: 1120 });
    expect((await position(f)).quantity.toString()).toBe("110");
    expect((await position(f)).investedValue?.toString()).toBe("1120");
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: s.id } })).executionStatus).toBe("AWAITING_SYNC");
    await provider(f, 110, { cost: 1120 });
    expect((await position(f)).investedValue?.toString()).toBe("1120");
  });
  it("updates paid cost by contribution ID without changing units or the provider snapshot", async () => {
    const f = await fixture(); const s = await buy(f, 10, 12);
    await saveAwaitingContributionPriceAction(s.id, 15);
    expect((await position(f)).quantity.toString()).toBe("110");
    expect((await position(f)).investedValue?.toString()).toBe("1150");
    expect((await db!.pluggyInvestment.findUniqueOrThrow({ where: { id: f.investment.id } })).amountOriginal?.toString()).toBe("1000");
  });
  it("accepts a newer provider position for a purchase made before its manual registration", async () => {
    const f = await fixture(); const s = await buy(f, 10);
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: {
      quantity: 110, balance: 1100, amountOriginal: 1120,
      providerUpdatedAt: new Date(Date.now() - 30_000),
    } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: s.id } })).syncResolution).toBe("PROVIDER_MATCH");
    expect((await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: f.link.id } })).overrideQuantity).toBeNull();
  });
  it("does not duplicate a purchase when concurrent registration requests race", async () => {
    const f = await fixture(); const s = await simulation(f);
    const results = await Promise.allSettled([1, 2].map(() => executeContributionAction(s.id, s.suggestions[0].id, 10, 12, { holdingId: f.holding.id })));
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await db!.contributionSuggestion.count({ where: { assetId: f.asset.id, usesQuantityProjection: true } })).toBe(1);
    expect((await position(f)).quantity.toString()).toBe("110");
  });
  it("requires explicit review for missing historical baselines and records the chosen total once", async () => {
    const f = await fixture(); const s = await simulation(f);
    await db!.contributionSuggestion.update({ where: { id: s.suggestions[0].id }, data: { executionStatus: "AWAITING_SYNC", awaitingSyncAt: new Date() } });
    // A legacy position with a missing baseline is never inferred from a balance.
    await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: s.suggestions[0].id } })).syncResolution).toBe("NEEDS_REVIEW");
    expect((await position(f)).quantity.toString()).toBe("100");
    await reviewAwaitingContributionAction({ suggestionId: s.suggestions[0].id, decision: "PROJECT", holdingId: f.holding.id, expectedQuantity: 110 });
    expect((await position(f)).quantity.toString()).toBe("110");
    await expect(reviewAwaitingContributionAction({ suggestionId: s.suggestions[0].id, decision: "PROJECT", holdingId: f.holding.id, expectedQuantity: 110 })).rejects.toThrow("não está mais disponível");
  });
});
