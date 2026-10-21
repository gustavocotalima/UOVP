import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPortfolioData } from "@/features/portfolio/data";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("moedas de custo no DTO da carteira", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("mantém custos BRL/USD separados apesar da mesma moeda de cotação", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: { email: `portfolio-cost-${suffix}@example.com`, portfolio: { create: {} } }, include: { portfolio: true },
    });
    userIds.push(user.id);
    const asset = await prisma.asset.create({
      data: {
        portfolioId: user.portfolio!.id, ticker: "KO", name: "Coca Cola",
        investmentClass: "INTERNATIONAL_STOCKS", instrumentType: "STOCK",
      },
    });
    const manual = await prisma.assetHolding.create({
      data: {
        assetId: asset.id, issuer: "Coca Cola", productName: "KO manual", positionSource: "MANUAL",
        pricingSource: "YAHOO", currency: "USD", quantity: 2, unitPrice: 75, fxRateToBrl: 6,
        investedValue: 500, investedValueCurrency: "BRL",
      },
    });
    const provider = await prisma.assetHolding.create({
      data: {
        assetId: asset.id, issuer: "Coca Cola", productName: "KO Pluggy", positionSource: "PLUGGY",
        pricingSource: "YAHOO", currency: "USD", quantity: 2, unitPrice: 75, fxRateToBrl: 6,
        investedValue: 100, investedValueCurrency: "USD",
      },
    });
    const item = await prisma.pluggyItem.create({
      data: { userId: user.id, pluggyItemId: `cost-item-${suffix}`, connectorName: "Banco de teste", status: "UPDATED", syncPending: false },
    });
    const investment = await prisma.pluggyInvestment.create({
      data: {
        pluggyItemDbId: item.id, pluggyInvestmentId: `cost-investment-${suffix}`, type: "EQUITY", name: "KO",
        code: "KO", currencyCode: "USD", amountOriginal: 100, quantity: 2, balance: 150, value: 75,
      },
    });
    await prisma.pluggyInvestmentDiagramLink.create({
      data: {
        userId: user.id, pluggyInvestmentDbId: investment.id, assetHoldingId: provider.id, status: "MAPPED",
      },
    });
    const mixed = (await getPortfolioData(user.id)).assets.find((candidate) => candidate.id === asset.id)!;
    expect(mixed).toMatchObject({ investedValue: null, investedValueCurrency: null, averagePricePaid: null, averagePriceCurrency: null });
    expect(mixed.holdings.find((holding) => holding.id === manual.id)).toMatchObject({
      investedValue: "500", investedValueCurrency: "BRL", averagePricePaid: "250", averagePriceCurrency: "BRL",
    });
    expect(mixed.holdings.find((holding) => holding.id === provider.id)).toMatchObject({
      investedValue: "100", investedValueCurrency: "USD", averagePricePaid: "50", averagePriceCurrency: "USD",
    });
    await prisma.assetHolding.update({
      where: { id: manual.id }, data: { investedValue: 100, investedValueCurrency: "USD" },
    });
    const consistent = (await getPortfolioData(user.id)).assets.find((candidate) => candidate.id === asset.id)!;
    expect(consistent).toMatchObject({ investedValue: "200", investedValueCurrency: "USD", averagePricePaid: "50", averagePriceCurrency: "USD" });

    await prisma.assetHolding.update({ where: { id: manual.id }, data: { investedValueCurrency: null } });
    const legacy = (await getPortfolioData(user.id)).assets.find((candidate) => candidate.id === asset.id)!;
    expect(legacy.investedValue).toBeNull();
    expect(legacy.holdings.find((holding) => holding.id === manual.id)).toMatchObject({
      investedValue: "100", investedValueCurrency: null, averagePricePaid: null, averagePriceCurrency: null,
    });
  });
});
