import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { reconcilePluggyInvestmentsForUser } from "@/features/open-finance/diagram-sync";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("cotações de mercado após sincronização Pluggy", () => {
  const userIds: string[] = [];
  const oldQuoteAt = new Date("2026-09-01T12:00:00Z");
  const marketQuoteAt = new Date("2026-10-02T12:00:00Z");
  const providerUpdatedAt = new Date("2026-10-02T13:00:00Z");

  async function fixture(manualQuote = false) {
    const suffix = randomUUID();
    const user = await db!.user.create({
      data: { email: `vitest-market-${suffix}@example.com`, portfolio: { create: {} } },
      include: { portfolio: true },
    });
    userIds.push(user.id);
    const item = await db!.pluggyItem.create({
      data: {
        userId: user.id,
        pluggyItemId: `market-item-${suffix}`,
        connectorName: "Banco de teste",
        status: "UPDATED",
        syncPending: false,
      },
    });
    if (manualQuote) {
      await db!.asset.create({
        data: {
          portfolioId: user.portfolio!.id,
          investmentClass: "BRAZILIAN_STOCKS",
          instrumentType: "STOCK",
          ticker: "VIVA3",
          name: "Vivara",
          holdings: {
            create: {
              positionSource: "MANUAL",
              pricingSource: "BRAPI",
              ticker: "VIVA3",
              issuer: "Vivara",
              productName: "VIVA3",
              quantity: 10,
              unitPrice: 10,
              currency: "BRL",
              priceUpdatedAt: oldQuoteAt,
            },
          },
        },
      });
    }
    const investment = await db!.pluggyInvestment.create({
      data: {
        pluggyItemDbId: item.id,
        pluggyInvestmentId: `market-investment-${suffix}`,
        name: "Vivara",
        code: "VIVA3",
        type: "EQUITY",
        subtype: "STOCK",
        quantity: 10,
        value: 11,
        balance: 110,
        currencyCode: "BRL",
        status: "ACTIVE",
        providerAvailable: true,
        quotaDate: providerUpdatedAt,
        providerUpdatedAt,
      },
    });
    return { userId: user.id, investmentId: investment.id };
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("mantém a cotação mais recente ao atualizar quantidade e snapshot do provedor", async () => {
    const { userId, investmentId } = await fixture(true);
    await reconcilePluggyInvestmentsForUser(userId);
    const link = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({
      where: { pluggyInvestmentDbId: investmentId },
    });
    await db!.assetHolding.update({
      where: { id: link.assetHoldingId! },
      data: { unitPrice: 20, priceUpdatedAt: marketQuoteAt },
    });
    await db!.pluggyInvestment.update({
      where: { id: investmentId },
      data: { quantity: 12, balance: 132, value: 11, providerUpdatedAt },
    });

    await reconcilePluggyInvestmentsForUser(userId);
    await reconcilePluggyInvestmentsForUser(userId);

    const holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: link.assetHoldingId! } });
    expect(holding.unitPrice.toString()).toBe("20");
    expect(holding.quantity.toString()).toBe("12");
    expect(holding.providerCurrentValue?.toString()).toBe("132");
    expect(holding.currentValue).toBeNull();
    expect(holding.priceUpdatedAt).toEqual(marketQuoteAt);
  });

  it("mantém o preço do provedor como fallback sem considerá-lo cotação de mercado recente", async () => {
    const { userId, investmentId } = await fixture();
    await reconcilePluggyInvestmentsForUser(userId);
    await reconcilePluggyInvestmentsForUser(userId);

    const link = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({
      where: { pluggyInvestmentDbId: investmentId },
      include: { holding: true },
    });
    expect(link.holding?.unitPrice.toString()).toBe("11");
    expect(link.holding?.priceUpdatedAt).toBeNull();
    expect(link.holding?.quantity.toString()).toBe("10");
  });
});
