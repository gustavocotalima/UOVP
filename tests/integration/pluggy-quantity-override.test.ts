import { createPrismaClient } from "../../lib/prisma-client";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import { reconcilePluggyInvestmentsForUser } from "@/features/open-finance/diagram-sync";
import { PLUGGY_DIAGRAM_EXCLUSION_REASON } from "@/features/open-finance/diagram-exclusion";
import { markPluggyItemDisconnected, resolvePluggyItemDisconnection } from "@/features/open-finance/disconnection";
import { holdingCurrentValue, holdingCurrentValueNative } from "@/features/portfolio/asset-groups";
import { getPortfolioData } from "@/features/portfolio/data";
import { getOpenFinanceData } from "@/features/open-finance/data";
import { resolvePluggyQuantityChangeAction } from "@/features/open-finance/diagram-actions";
import { saveAssetAction } from "@/features/portfolio/actions";

const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => currentUser.id }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { portfolioTools } from "@/features/mcp/portfolio-tools";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? createPrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("quantidade temporária de posições Pluggy", () => {
  const userIds: string[] = [];
  const quoteAt = new Date("2026-10-14T12:00:00.000Z");

  async function fixture({
    currency = "BRL",
    rawQuantity = 0,
    status = "TOTAL_WITHDRAWAL",
  }: { currency?: "BRL" | "USD"; rawQuantity?: number; status?: string } = {}) {
    const suffix = randomUUID();
    const international = currency === "USD";
    const ticker = international ? "KO" : "ITUB3";
    const unitPrice = international ? 200 : 50;
    const user = await db!.user.create({
      data: { email: `vitest-quantity-${suffix}@example.com`, portfolio: { create: {} } },
      include: { portfolio: true },
    });
    userIds.push(user.id);
    currentUser.id = user.id;
    const item = await db!.pluggyItem.create({
      data: {
        userId: user.id,
        pluggyItemId: `quantity-item-${suffix}`,
        connectorName: "Banco de teste",
        institutionName: "Banco de teste",
        status: "UPDATED",
        syncPending: false,
        lastSyncAt: quoteAt,
      },
    });
    const investment = await db!.pluggyInvestment.create({
      data: {
        pluggyItemDbId: item.id,
        pluggyInvestmentId: `quantity-investment-${suffix}`,
        name: ticker,
        code: ticker,
        type: "EQUITY",
        subtype: "STOCK",
        currencyCode: currency,
        quantity: rawQuantity,
        balance: rawQuantity * unitPrice,
        value: rawQuantity ? unitPrice : 0,
        status,
        providerAvailable: true,
        providerUpdatedAt: quoteAt,
      },
    });
    const asset = await db!.asset.create({
      data: {
        portfolioId: user.portfolio!.id,
        instrumentType: "STOCK",
        investmentClass: international ? "INTERNATIONAL_STOCKS" : "BRAZILIAN_STOCKS",
        ticker,
        name: ticker,
        score: 9,
      },
    });
    const holding = await db!.assetHolding.create({
      data: {
        assetId: asset.id,
        positionSource: "PLUGGY",
        pricingSource: international ? "YAHOO" : "BRAPI",
        productName: ticker,
        issuer: "Emissor de teste",
        ticker,
        currency,
        quantity: rawQuantity,
        unitPrice,
        fxRateToBrl: international ? 5.25 : null,
        fxUpdatedAt: international ? quoteAt : null,
        providerCurrentValue: rawQuantity * unitPrice,
        includedInTotals: status === "ACTIVE",
        fractional: international,
        priceUpdatedAt: quoteAt,
      },
    });
    const link = await db!.pluggyInvestmentDiagramLink.create({
      data: {
        userId: user.id,
        pluggyInvestmentDbId: investment.id,
        assetHoldingId: holding.id,
        status: "MAPPED",
        classificationSource: "USER_OVERRIDE",
        suggestedInstrumentType: "STOCK",
        suggestedInvestmentClass: asset.investmentClass,
        lastReconciledAt: quoteAt,
      },
    });
    const operation = await db!.pluggyInvestmentTransaction.create({
      data: {
        pluggyInvestmentDbId: investment.id,
        pluggyInvestmentTransactionId: `quantity-operation-${suffix}`,
        type: "BUY",
        quantity: 110,
        value: 40,
        amount: 4_400,
        date: new Date("2026-07-01T12:00:00.000Z"),
      },
    });
    return { user, item, investment, asset, holding, link, operation };
  }

  async function customQuantity(linkId: string, quantity: number) {
    const link = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({
      where: { id: linkId }, include: { investment: { select: { quantity: true } } },
    });
    await db!.pluggyInvestmentDiagramLink.update({
      where: { id: linkId },
      data: {
        metadataOverrideFields: { set: ["QUANTITY"] },
        overrideQuantity: new Prisma.Decimal(quantity),
        overrideQuantityProviderQuantity: link.investment.quantity,
        overrideQuantityAcknowledgedAt: new Date(),
        metadataOverrideUpdatedAt: new Date(),
      },
    });
  }

  async function restoreQuantity(linkId: string) {
    await db!.pluggyInvestmentDiagramLink.update({
      where: { id: linkId },
      data: {
        metadataOverrideFields: { set: [] }, overrideQuantity: null,
        overrideQuantityProviderQuantity: null, overrideQuantityAcknowledgedAt: null,
      },
    });
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("recoloca a posição zerada na Carteira sem alterar snapshot ou operações", async () => {
    const f = await fixture();
    await customQuantity(f.link.id, 110);
    const version = f.user.portfolio!.version;

    await reconcilePluggyInvestmentsForUser(f.user.id);
    await reconcilePluggyInvestmentsForUser(f.user.id);

    const [holding, raw, operations, asset, portfolio] = await Promise.all([
      db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } }),
      db!.pluggyInvestment.findUniqueOrThrow({ where: { id: f.investment.id } }),
      db!.pluggyInvestmentTransaction.findMany({ where: { pluggyInvestmentDbId: f.investment.id } }),
      db!.asset.findUniqueOrThrow({ where: { id: f.asset.id } }),
      db!.portfolio.findUniqueOrThrow({ where: { id: f.user.portfolio!.id } }),
    ]);
    expect(holding.quantity.toString()).toBe("110");
    expect(holding.includedInTotals).toBe(true);
    expect(holding.unitPrice.toString()).toBe("50");
    expect(holding.providerCurrentValue?.toString()).toBe("0");
    expect(holdingCurrentValue(holding).toString()).toBe("5500");
    expect(raw.quantity?.toString()).toBe("0");
    expect(raw.balance.toString()).toBe("0");
    expect(raw.status).toBe("TOTAL_WITHDRAWAL");
    expect(operations).toEqual([f.operation]);
    expect(asset.score).toBe(9);
    expect(portfolio.version).toBeGreaterThan(version);
    const details = await portfolioTools.find((tool) => tool.name === "get_holding_details")!.execute({
      userId: f.user.id,
      scopes: ["portfolio:read"],
      clientId: "quantity-override-test",
      grantId: "quantity-override-test",
      timeZone: "America/Sao_Paulo",
    }, { holdingId: f.holding.id });
    expect(details).toMatchObject({
      holding: {
        quantity: "110",
        includedInTotals: true,
        currentValueBrl: "5500",
        providerMetadata: { quantity: "0", status: "TOTAL_WITHDRAWAL" },
        overrideFields: ["QUANTITY"],
        quantityOverride: { quantity: "110", providerQuantity: "0", source: "USER_OVERRIDE" },
      },
    });
  });

  it("preserva a quantidade personalizada quando a instituição passa a informar outro valor", async () => {
    const f = await fixture();
    await customQuantity(f.link.id, 110);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    await db!.pluggyInvestment.update({
      where: { id: f.investment.id },
      data: { quantity: 120, balance: 6_120, value: 51, status: "ACTIVE", providerUpdatedAt: new Date() },
    });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    let holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.quantity.toString()).toBe("110");
    expect(holding.providerCurrentValue?.toString()).toBe("6120");

    await restoreQuantity(f.link.id);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.quantity.toString()).toBe("120");
    expect(holding.includedInTotals).toBe(true);
  });

  it("restaurar a instituição ainda zerada remove a posição dos totais", async () => {
    const f = await fixture();
    await customQuantity(f.link.id, 110);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    await restoreQuantity(f.link.id);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    const holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.quantity.toString()).toBe("0");
    expect(holding.includedInTotals).toBe(false);
  });

  it("preserva a escolha manual e o aviso nos dois painéis até o reconhecimento, voltando a avisar em outra mudança", async () => {
    const f = await fixture();
    await customQuantity(f.link.id, 110);
    await db!.pluggyInvestment.update({
      where: { id: f.investment.id }, data: { quantity: 120, balance: 6_000, status: "ACTIVE" },
    });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    for (const data of [await getPortfolioData(f.user.id), await getOpenFinanceData(f.user.id)]) {
      expect(data.quantityChanges).toEqual([expect.objectContaining({
        linkId: f.link.id, previousProviderQuantity: "0", providerQuantity: "120", manualQuantity: "110",
      })]);
    }
    expect((await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } })).quantity.toString()).toBe("110");
    const warning = (await getPortfolioData(f.user.id)).quantityChanges[0];
    expect(await resolvePluggyQuantityChangeAction({
      linkId: warning.linkId, expectedUpdatedAt: warning.expectedUpdatedAt,
      expectedProviderQuantity: warning.providerQuantity, decision: "KEEP_MANUAL",
    })).toEqual({ status: "SAVED" });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    expect((await getPortfolioData(f.user.id)).quantityChanges).toEqual([]);
    expect((await getOpenFinanceData(f.user.id)).quantityChanges).toEqual([]);
    await db!.pluggyInvestment.update({ where: { id: f.investment.id }, data: { quantity: 130, balance: 6_500 } });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    const nextWarning = (await getPortfolioData(f.user.id)).quantityChanges[0];
    expect(nextWarning).toMatchObject({
      previousProviderQuantity: "120", providerQuantity: "130", manualQuantity: "110",
    });
    expect(await resolvePluggyQuantityChangeAction({
      linkId: nextWarning.linkId, expectedUpdatedAt: nextWarning.expectedUpdatedAt,
      expectedProviderQuantity: nextWarning.providerQuantity, decision: "PROVIDER",
    })).toEqual({ status: "SAVED" });
    expect((await getPortfolioData(f.user.id)).quantityChanges).toEqual([]);
    expect((await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } })).quantity.toString()).toBe("130");
  });

  it("exibe revisão mesmo com quantidade manual zero fora dos totais da Carteira", async () => {
    const f = await fixture();
    await customQuantity(f.link.id, 0);
    await db!.pluggyInvestment.update({
      where: { id: f.investment.id }, data: { quantity: 10, balance: 500, status: "ACTIVE" },
    });
    await reconcilePluggyInvestmentsForUser(f.user.id);
    const data = await getPortfolioData(f.user.id);
    expect(data.assets).toEqual([]);
    expect(data.quantityChanges[0]).toMatchObject({ manualQuantity: "0", providerQuantity: "10" });
  });

  it("salva detalhes e quantidade no editor de ativo e permite restaurar a instituição", async () => {
    const f = await fixture();
    await customQuantity(f.link.id, 110);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    const link = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: f.link.id } });
    const payload = {
      id: f.asset.id, investmentClass: "BRAZILIAN_STOCKS" as const, instrumentType: "STOCK" as const,
      ticker: "ITUB3", name: "Itaú corrigido", quantity: 110, unitPrice: 50, currency: "BRL", score: 7,
    };
    await saveAssetAction({
      ...payload,
      quantityEdits: [{ linkId: link.id, expectedUpdatedAt: link.updatedAt, expectedProviderQuantity: "0", mode: "CUSTOM", value: 115 }],
    });
    let holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.quantity.toString()).toBe("115");
    expect(holding.includedInTotals).toBe(true);
    expect((await db!.asset.findUniqueOrThrow({ where: { id: f.asset.id } })).name).toBe("Itaú corrigido");
    expect((await db!.asset.findUniqueOrThrow({ where: { id: f.asset.id } })).score).toBe(7);
    expect((await db!.pluggyInvestment.findUniqueOrThrow({ where: { id: f.investment.id } })).quantity?.toString()).toBe("0");
    const saved = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(saved.overrideQuantityProviderQuantity?.toString()).toBe("0");
    await saveAssetAction({
      ...payload,
      quantityEdits: [{ linkId: saved.id, expectedUpdatedAt: saved.updatedAt, expectedProviderQuantity: "0", mode: "PROVIDER", value: null }],
    });
    holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.quantity.toString()).toBe("0");
    expect(holding.includedInTotals).toBe(false);
    expect(await db!.assetHolding.count({ where: { assetId: f.asset.id } })).toBe(1);
    expect(await db!.pluggyInvestmentTransaction.count({ where: { pluggyInvestmentDbId: f.investment.id } })).toBe(1);
  });

  it("não salva parcialmente o ativo quando uma das quantidades pertence a outro usuário", async () => {
    const f = await fixture();
    await customQuantity(f.link.id, 110);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    const other = await fixture();
    currentUser.id = f.user.id;
    const link = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: f.link.id } });
    await expect(saveAssetAction({
      id: f.asset.id, investmentClass: "BRAZILIAN_STOCKS", instrumentType: "STOCK", ticker: "ITUB3",
      name: "Não deve ser salvo", quantity: 110, unitPrice: 50, currency: "BRL", score: 7,
      quantityEdits: [
        { linkId: link.id, expectedUpdatedAt: link.updatedAt, expectedProviderQuantity: "0", mode: "CUSTOM", value: 115 },
        { linkId: other.link.id, expectedUpdatedAt: other.link.updatedAt, expectedProviderQuantity: "0", mode: "CUSTOM", value: 20 },
      ],
    })).rejects.toThrow("Posição conectada não encontrada");
    expect((await db!.asset.findUniqueOrThrow({ where: { id: f.asset.id } })).name).toBe("ITUB3");
    expect((await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } })).quantity.toString()).toBe("110");
  });

  it("aceita zero explícito sem reutilizar o saldo positivo informado pela instituição", async () => {
    const f = await fixture({ rawQuantity: 110, status: "ACTIVE" });
    await customQuantity(f.link.id, 0);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    const holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.quantity.toString()).toBe("0");
    expect(holding.providerCurrentValue?.toString()).toBe("5500");
    expect(holding.includedInTotals ? holdingCurrentValue(holding).toString() : "0").toBe("0");
  });

  it.each(["EXCLUDED", "UNAVAILABLE", "DISCONNECTED"] as const)(
    "não reativa uma posição %s só porque existe uma quantidade personalizada",
    async (state) => {
      const f = await fixture();
      await customQuantity(f.link.id, 110);
      if (state === "EXCLUDED") {
        await db!.pluggyInvestmentDiagramLink.update({
          where: { id: f.link.id },
          data: { status: "EXCLUDED", reviewReason: PLUGGY_DIAGRAM_EXCLUSION_REASON.USER },
        });
      } else if (state === "UNAVAILABLE") {
        await db!.pluggyInvestment.update({
          where: { id: f.investment.id },
          data: { providerAvailable: false, providerRemovedAt: new Date() },
        });
      } else {
        await db!.pluggyItem.update({
          where: { id: f.item.id },
          data: { status: "DELETED", disconnectedAt: new Date(), disconnectionResolution: "REMOVE" },
        });
      }
      await reconcilePluggyInvestmentsForUser(f.user.id);
      const holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
      expect(holding.includedInTotals).toBe(false);
    },
  );

  it("calcula ações internacionais fracionárias com a cotação e câmbio existentes", async () => {
    const f = await fixture({ currency: "USD" });
    await customQuantity(f.link.id, 0.75);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    const holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.quantity.toString()).toBe("0.75");
    expect(holding.includedInTotals).toBe(true);
    expect(holding.fxRateToBrl?.toString()).toBe("5.25");
    expect(holdingCurrentValueNative(holding)?.toString()).toBe("150");
    expect(holdingCurrentValue(holding).toString()).toBe("787.5");
  });

  it("não confirma um aporte só porque o usuário corrigiu a quantidade", async () => {
    const f = await fixture();
    const simulation = await db!.contributionSimulation.create({
      data: {
        userId: f.user.id,
        portfolioVersion: f.user.portfolio!.version, allocationMethod: "IMPROVED", calculationVersion: "2",
        inputAmount: 500,
        requestedAmount: 500,
        unallocatedAmount: 0,
        suggestions: {
          create: {
            assetId: f.asset.id,
            quantity: 10,
            value: 500,
            suggestionPercentage: 100,
            totalAfterSuggestionPercentage: 100,
            executionStatus: "AWAITING_SYNC",
            awaitingSyncAt: new Date("2026-10-13T12:00:00.000Z"),
            baselineQuantity: 0,
            baselineValue: 0,
            externalBaselines: {
              create: { holdingId: f.holding.id, quantity: 0, providerValue: 0, currency: "BRL", fxRateToBrl: 1 },
            },
          },
        },
      },
      include: { suggestions: true },
    });
    await customQuantity(f.link.id, 110);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    const suggestion = await db!.contributionSuggestion.findUniqueOrThrow({
      where: { id: simulation.suggestions[0].id },
    });
    expect(suggestion.executionStatus).toBe("AWAITING_SYNC");
    expect(suggestion.executed).toBe(false);
    expect(suggestion.confirmationReference).toBeNull();
  });

  it("materializa a quantidade efetiva ao manter a posição como manual na desconexão", async () => {
    const f = await fixture();
    await customQuantity(f.link.id, 110);
    await reconcilePluggyInvestmentsForUser(f.user.id);
    await markPluggyItemDisconnected(f.item.pluggyItemId);
    await resolvePluggyItemDisconnection(f.user.id, f.item.id, "KEEP_MANUAL");
    const [holding, link, raw] = await Promise.all([
      db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } }),
      db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: f.link.id } }),
      db!.pluggyInvestment.findUniqueOrThrow({ where: { id: f.investment.id } }),
    ]);
    expect(holding.positionSource).toBe("MANUAL");
    expect(holding.quantity.toString()).toBe("110");
    expect(holding.includedInTotals).toBe(true);
    expect(holdingCurrentValue(holding).toString()).toBe("5500");
    expect(link.assetHoldingId).toBeNull();
    expect(link.metadataOverrideFields).toEqual([]);
    expect(link.overrideQuantity).toBeNull();
    expect(raw.quantity?.toString()).toBe("0");
    expect(await db!.pluggyInvestmentTransaction.count({ where: { pluggyInvestmentDbId: f.investment.id } })).toBe(1);
  });

  it("não altera a posição de outro usuário com o mesmo ticker", async () => {
    const [first, second] = await Promise.all([fixture(), fixture({ rawQuantity: 3, status: "ACTIVE" })]);
    await customQuantity(first.link.id, 110);
    await reconcilePluggyInvestmentsForUser(first.user.id);
    const [holding, link] = await Promise.all([
      db!.assetHolding.findUniqueOrThrow({ where: { id: second.holding.id } }),
      db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: second.link.id } }),
    ]);
    expect(holding.quantity.toString()).toBe("3");
    expect(link.metadataOverrideFields).toEqual([]);
    expect(link.overrideQuantity).toBeNull();
  });
});
