import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => currentUser.id }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { importPortfolioRowsAction } from "@/features/portfolio/actions";
import { getPortfolioData } from "@/features/portfolio/data";
import { parsePortfolioImportRows } from "@/features/portfolio/portfolio-import";
import { portfolioRows } from "@/features/portfolio/xlsx-export";
import { resolvePluggyItemDisconnection } from "@/features/open-finance/disconnection";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const fxDate = new Date("2026-10-01T12:00:00Z");

suite("roundtrip de posição estrangeira mantida manualmente", () => {
  const users: string[] = [];

  async function fixture() {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: { email: `foreign-roundtrip-${suffix}@example.com`, portfolio: { create: {} } }, include: { portfolio: true },
    });
    currentUser.id = user.id;
    users.push(user.id);
    const item = await prisma.pluggyItem.create({
      data: {
        userId: user.id, pluggyItemId: randomUUID(), connectorName: "Banco de teste", status: "DELETED",
        disconnectedAt: new Date(), disconnectionResolution: "PENDING", syncPending: false,
      },
    });
    const investment = await prisma.pluggyInvestment.create({
      data: {
        pluggyItemDbId: item.id, pluggyInvestmentId: randomUUID(), type: "MUTUAL_FUND", name: "Fundo internacional",
        currencyCode: "USD", balance: 100, amountOriginal: 80, quantity: 1, value: 100, status: "ACTIVE", providerAvailable: true,
      },
    });
    const asset = await prisma.asset.create({
      data: {
        portfolioId: user.portfolio!.id, instrumentType: "MUTUAL_FUND", investmentClass: "INTERNATIONAL_STOCKS",
        ticker: "FUND-USD", name: "Fundo internacional", score: 5,
        holdings: { create: {
          issuer: "Gestora", productName: "Fundo internacional", positionSource: "PLUGGY", pricingSource: "PLUGGY",
          currency: "USD", quantity: 1, unitPrice: 100, currentValue: 100, providerCurrentValue: 100,
          fxRateToBrl: 5, fxUpdatedAt: fxDate, investedValue: 80, investedValueCurrency: "USD",
        } },
      }, include: { holdings: true },
    });
    const holding = asset.holdings[0];
    await prisma.pluggyInvestmentDiagramLink.create({
      data: { userId: user.id, pluggyInvestmentDbId: investment.id, assetHoldingId: holding.id, status: "MAPPED" },
    });
    await resolvePluggyItemDisconnection(user.id, item.id, "KEEP_MANUAL");
    return { user, asset, holding };
  }

  async function exported(userId: string) {
    const portfolio = await getPortfolioData(userId);
    const [headers, ...rows] = portfolioRows(portfolio.assets);
    return rows.map((row) => Object.fromEntries(headers.map((header, index) => [String(header), row[index]])));
  }

  afterAll(async () => {
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("exporta/importa duas vezes sem converter BRL em USD nem perder custo ou FX", async () => {
    const f = await fixture();
    for (let pass = 0; pass < 2; pass += 1) {
      const records = await exported(f.user.id);
      expect(records[0]).toMatchObject({ "Valor atual": 500, "Valor atual nativo": 100, "Moeda": "USD", "Câmbio para BRL": "5" });
      if (pass === 1) {
        // Omission preserves FX only because the exported holding ID identifies
        // the same owned position and the native currency has not changed.
        delete records[0]["Câmbio para BRL"];
        delete records[0]["Data do câmbio"];
      }
      await importPortfolioRowsAction(parsePortfolioImportRows(records, [], []));
      const stored = await prisma.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
      expect(stored).toMatchObject({ positionSource: "MANUAL", currency: "USD", investedValueCurrency: "USD", fxUpdatedAt: fxDate });
      expect(stored.currentValue?.toString()).toBe("100");
      expect(stored.investedValue?.toString()).toBe("80");
      expect(stored.fxRateToBrl?.toString()).toBe("5");
      const dto = (await getPortfolioData(f.user.id)).assets.find((asset) => asset.id === f.asset.id)!;
      expect(dto).toMatchObject({ currentValue: "500", nativeCurrentValue: "100" });
      expect(await prisma.assetHolding.count({ where: { assetId: f.asset.id } })).toBe(1);
    }
  });

  it("rejeita uma nova posição estrangeira sem FX e um saldo consolidado com unidade ambígua", async () => {
    const f = await fixture();
    const records = await exported(f.user.id);
    const before = await prisma.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    delete records[0]["ID da aplicação"];
    delete records[0]["Câmbio para BRL"];
    delete records[0]["Data do câmbio"];
    records[0].Ticker = "NEW-USD";
    await expect(importPortfolioRowsAction(parsePortfolioImportRows(records, [], []))).rejects.toThrow("câmbio para BRL válido");
    expect(await prisma.asset.count({ where: { portfolioId: f.user.portfolio!.id, ticker: "NEW-USD" } })).toBe(0);
    const legacy = await exported(f.user.id);
    delete legacy[0]["Valor atual nativo"];
    await expect(importPortfolioRowsAction(parsePortfolioImportRows(legacy, [], []))).rejects.toThrow("Valor atual nativo");
    expect(await prisma.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } })).toEqual(before);
  });
});
