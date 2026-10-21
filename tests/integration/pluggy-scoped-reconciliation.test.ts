import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { reconcilePluggyInvestmentsForUser } from "@/features/open-finance/diagram-sync";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;
const quoteAt = new Date("2026-01-01T12:00:00Z");

suite("reconciliação Pluggy por conexão", () => {
  const userIds: string[] = [];

  async function fixture() {
    const suffix = randomUUID();
    const user = await db!.user.create({
      data: { email: `scoped-pluggy-${suffix}@example.com`, portfolio: { create: {} } },
      include: { portfolio: true },
    });
    userIds.push(user.id);
    const asset = await db!.asset.create({
      data: {
        portfolioId: user.portfolio!.id, ticker: "ITUB3", name: "Itaú",
        instrumentType: "STOCK", investmentClass: "BRAZILIAN_STOCKS", score: 5,
      },
    });
    async function position(quantity: number, targetAsset = asset) {
      const id = randomUUID();
      const item = await db!.pluggyItem.create({
        data: {
          userId: user.id, pluggyItemId: `scope-item-${id}`, connectorName: "Banco de teste",
          status: "UPDATED", syncPending: false,
        },
      });
      const investment = await db!.pluggyInvestment.create({
        data: {
          pluggyItemDbId: item.id, pluggyInvestmentId: `scope-investment-${id}`,
          name: targetAsset.ticker, code: targetAsset.ticker, type: "EQUITY", subtype: "STOCK",
          currencyCode: "BRL", quantity, balance: quantity * 50, value: 50,
          status: "ACTIVE", providerAvailable: true, providerUpdatedAt: quoteAt,
        },
      });
      const holding = await db!.assetHolding.create({
        data: {
          assetId: targetAsset.id, ticker: targetAsset.ticker, productName: targetAsset.name, issuer: "Banco de teste",
          positionSource: "PLUGGY", pricingSource: "BRAPI", currency: "BRL",
          quantity, unitPrice: 50, providerCurrentValue: quantity * 50,
          includedInTotals: true, fractional: false, priceUpdatedAt: quoteAt,
        },
      });
      const link = await db!.pluggyInvestmentDiagramLink.create({
        data: {
          userId: user.id, pluggyInvestmentDbId: investment.id, assetHoldingId: holding.id,
          status: "MAPPED", classificationSource: "USER_OVERRIDE",
          suggestedInstrumentType: "STOCK", suggestedInvestmentClass: "BRAZILIAN_STOCKS",
          lastReconciledAt: quoteAt,
        },
      });
      return { item, investment, holding, link };
    }
    const first = await position(10);
    const second = await position(20);
    return { user, asset, first, second, position };
  }

  async function suggestion(userId: string, assetId: string, baselineQuantity: number, quantity: number) {
    const simulation = await db!.contributionSimulation.create({
      data: {
        userId, portfolioVersion: 0, inputAmount: quantity * 50,
        requestedAmount: quantity * 50, unallocatedAmount: 0,
      },
    });
    return db!.contributionSuggestion.create({
      data: {
        simulationId: simulation.id, assetId, quantity, value: quantity * 50,
        suggestionPercentage: 100, totalAfterSuggestionPercentage: 100,
        executionStatus: "AWAITING_SYNC", awaitingSyncAt: new Date("2026-10-01T12:00:00Z"),
        baselineQuantity,
      },
    });
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("atualiza apenas o item pedido e retira dos totais posições removidas, inclusive indisponíveis", async () => {
    const f = await fixture();
    await db!.pluggyInvestment.update({
      where: { id: f.first.investment.id },
      data: { providerAvailable: false, providerRemovedAt: new Date(), quantity: 0, balance: 0 },
    });
    await db!.pluggyInvestment.update({
      where: { id: f.second.investment.id }, data: { quantity: 99, balance: 4_950 },
    });
    const result = await reconcilePluggyInvestmentsForUser(f.user.id, undefined, { pluggyItemDbId: f.first.item.id });
    const [first, second, link] = await Promise.all([
      db!.assetHolding.findUniqueOrThrow({ where: { id: f.first.holding.id } }),
      db!.assetHolding.findUniqueOrThrow({ where: { id: f.second.holding.id } }),
      db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: f.second.link.id } }),
    ]);
    expect(first.includedInTotals).toBe(false);
    expect(first.quantity.toString()).toBe("0");
    expect(second).toEqual(f.second.holding);
    expect(link.lastReconciledAt).toEqual(quoteAt);
    expect(result).toMatchObject({ mapped: 0, changed: true });
  });

  it("preserva metadados, quantidade manual e a posição de uma desconexão pendente", async () => {
    const f = await fixture();
    await db!.pluggyInvestment.update({
      where: { id: f.first.investment.id }, data: { quantity: 0, balance: 0, status: "TOTAL_WITHDRAWAL" },
    });
    await db!.pluggyInvestmentDiagramLink.update({
      where: { id: f.first.link.id },
      data: {
        metadataOverrideFields: { set: ["QUANTITY", "PRODUCT_NAME"] },
        overrideQuantity: new Prisma.Decimal(15), overrideQuantityProviderQuantity: new Prisma.Decimal(10),
        overrideQuantityAcknowledgedAt: new Date(), overrideProductName: "Nome personalizado",
      },
    });
    await reconcilePluggyInvestmentsForUser(f.user.id, undefined, { pluggyItemDbId: f.first.item.id });
    const overridden = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.first.holding.id } });
    expect(overridden.quantity.toString()).toBe("15");
    expect(overridden.productName).toBe("Nome personalizado");
    expect(overridden.includedInTotals).toBe(true);

    await db!.pluggyItem.update({
      where: { id: f.first.item.id },
      data: { status: "DELETED", disconnectedAt: new Date(), disconnectionResolution: "PENDING" },
    });
    await db!.pluggyInvestment.update({ where: { id: f.first.investment.id }, data: { providerAvailable: false } });
    await reconcilePluggyInvestmentsForUser(f.user.id, undefined, { pluggyItemDbId: f.first.item.id });
    expect(await db!.assetHolding.findUniqueOrThrow({ where: { id: f.first.holding.id } })).toEqual(overridden);
  });

  it("confirma aportes usando holdings de todas as conexões do ativo e ignora sugestões de outros ativos", async () => {
    const f = await fixture();
    const target = await suggestion(f.user.id, f.asset.id, 30, 5);
    const otherAsset = await db!.asset.create({
      data: {
        portfolioId: f.user.portfolio!.id, ticker: "BBDC4", name: "Bradesco",
        instrumentType: "STOCK", investmentClass: "BRAZILIAN_STOCKS", score: 5,
      },
    });
    await f.position(40, otherAsset);
    const unrelated = await suggestion(f.user.id, otherAsset.id, 30, 5);
    await db!.pluggyInvestment.update({
      where: { id: f.first.investment.id }, data: { quantity: 15, balance: 750 },
    });
    await reconcilePluggyInvestmentsForUser(f.user.id, undefined, { pluggyItemDbId: f.first.item.id });
    const [confirmed, untouched] = await Promise.all([
      db!.contributionSuggestion.findUniqueOrThrow({ where: { id: target.id } }),
      db!.contributionSuggestion.findUniqueOrThrow({ where: { id: unrelated.id } }),
    ]);
    expect(confirmed.executionStatus).toBe("EXECUTED");
    expect(confirmed.confirmationReference).toContain(":35:");
    expect(untouched.executionStatus).toBe("AWAITING_SYNC");
  });

  it("reavalia sugestões tanto do ativo antigo quanto do novo quando o vínculo muda", async () => {
    const f = await fixture();
    const nextAsset = await db!.asset.create({
      data: {
        portfolioId: f.user.portfolio!.id, ticker: "BBDC4", name: "Bradesco",
        instrumentType: "STOCK", investmentClass: "BRAZILIAN_STOCKS", score: 5,
      },
    });
    await f.position(40, nextAsset);
    const oldSuggestion = await suggestion(f.user.id, f.asset.id, 10, 5);
    const nextSuggestion = await suggestion(f.user.id, nextAsset.id, 40, 5);
    await db!.pluggyInvestment.update({
      where: { id: f.first.investment.id },
      data: { code: "BBDC4", name: "Bradesco", quantity: 15, balance: 750 },
    });
    await reconcilePluggyInvestmentsForUser(f.user.id, undefined, { pluggyItemDbId: f.first.item.id });
    expect((await db!.assetHolding.findUniqueOrThrow({ where: { id: f.first.holding.id } })).assetId).toBe(nextAsset.id);
    const suggestions = await db!.contributionSuggestion.findMany({
      where: { id: { in: [oldSuggestion.id, nextSuggestion.id] } },
    });
    expect(suggestions).toHaveLength(2);
    expect(suggestions.every((item) => item.executionStatus === "EXECUTED")).toBe(true);
  });

  it("aplica o filtro de usuário mesmo quando o ID do item pertence a outra pessoa", async () => {
    const first = await fixture();
    const other = await fixture();
    await db!.pluggyInvestment.update({ where: { id: other.first.investment.id }, data: { quantity: 99, balance: 4_950 } });
    const before = await db!.portfolio.findUniqueOrThrow({ where: { userId: first.user.id } });
    expect(await reconcilePluggyInvestmentsForUser(first.user.id, undefined, { pluggyItemDbId: other.first.item.id })).toEqual({
      mapped: 0, review: 0, changed: false,
    });
    expect(await db!.assetHolding.findUniqueOrThrow({ where: { id: other.first.holding.id } })).toEqual(other.first.holding);
    expect((await db!.portfolio.findUniqueOrThrow({ where: { userId: first.user.id } })).version).toBe(before.version);
  });

  it("mantém reconciliação global nas chamadas sem escopo", async () => {
    const f = await fixture();
    await db!.pluggyInvestment.update({ where: { id: f.first.investment.id }, data: { quantity: 11, balance: 550 } });
    await db!.pluggyInvestment.update({ where: { id: f.second.investment.id }, data: { quantity: 22, balance: 1_100 } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await db!.assetHolding.findUniqueOrThrow({ where: { id: f.first.holding.id } })).quantity.toString()).toBe("11");
    expect((await db!.assetHolding.findUniqueOrThrow({ where: { id: f.second.holding.id } })).quantity.toString()).toBe("22");
  });
});
