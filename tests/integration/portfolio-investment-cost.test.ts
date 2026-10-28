import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";

const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => currentUser.id }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { executeContributionAction, importPortfolioRowsAction, saveAssetAction, saveAssetHoldingAction } from "@/features/portfolio/actions";
import { getPortfolioData } from "@/features/portfolio/data";
import { parsePortfolioImportRows } from "@/features/portfolio/portfolio-import";
import { portfolioRows } from "@/features/portfolio/xlsx-export";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("preservação do custo histórico nas gravações e planilhas", () => {
  const userIds: string[] = [];
  const familyCodes: string[] = [];

  async function fixture(cost: number | null = 1_000) {
    const user = await db!.user.create({
      data: { email: `investment-cost-${randomUUID()}@example.com`, portfolio: { create: {} } },
      include: { portfolio: true },
    });
    userIds.push(user.id);
    currentUser.id = user.id;
    const asset = await db!.asset.create({
      data: {
        portfolioId: user.portfolio!.id, instrumentType: "MUTUAL_FUND", investmentClass: "STORE_OF_VALUE", ticker: "FUNDO", name: "Fundo manual", score: 3,
        holdings: { create: { issuer: "Gestora", productName: "Fundo manual", pricingSource: "MANUAL", quantity: 20, unitPrice: 100, currentValue: 2_000, investedValue: cost, investedValueCurrency: cost == null ? null : "BRL" } },
      },
      include: { holdings: true },
    });
    return { user, asset, holding: asset.holdings[0] };
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.fixedIncomeFamily.deleteMany({ where: { code: { in: familyCodes } } });
    await db.$disconnect();
  });

  it("reimportar a posição valorizada conserva custo e moeda", async () => {
    const f = await fixture();
    const portfolio = await getPortfolioData(f.user.id);
    const [headers, ...rows] = portfolioRows(portfolio.assets);
    const records = rows.map((row) => Object.fromEntries(headers.map((header, index) => [String(header), row[index]])));
    await importPortfolioRowsAction(parsePortfolioImportRows(records, [], []));
    const holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.investedValue?.toString()).toBe("1000");
    expect(holding.investedValueCurrency).toBe("BRL");
    expect(holding.currentValue?.toString()).toBe("2000");
    expect(await db!.assetHolding.count({ where: { assetId: f.asset.id } })).toBe(1);
  });

  it("roundtrip por ID preserva posições manuais mantidas separadas", async () => {
    const f = await fixture();
    const second = await db!.assetHolding.create({
      data: { assetId: f.asset.id, issuer: "Outra origem", productName: "Posição mantida", pricingSource: "MANUAL", quantity: 5, unitPrice: 120, currentValue: 600, investedValue: 400, investedValueCurrency: "BRL" },
    });
    const portfolio = await getPortfolioData(f.user.id);
    const [headers, ...rows] = portfolioRows(portfolio.assets);
    const records = rows.map((row) => Object.fromEntries(headers.map((header, index) => [String(header), row[index]])));
    const parsed = parsePortfolioImportRows(records, [], []);
    expect(parsed.marketRows.map((row) => row.holdingId).sort()).toEqual([f.holding.id, second.id].sort());
    await importPortfolioRowsAction(parsed);
    await importPortfolioRowsAction(parsed);
    await saveAssetAction({ id: f.asset.id, instrumentType: "MUTUAL_FUND", investmentClass: "STORE_OF_VALUE", ticker: "FUNDO", name: "Nome atualizado", quantity: 25, unitPrice: 104 });
    const holdings = await db!.assetHolding.findMany({ where: { assetId: f.asset.id } });
    expect(holdings).toHaveLength(2);
    expect(holdings.find((holding) => holding.id === f.holding.id)?.quantity.toString()).toBe("20");
    expect(holdings.find((holding) => holding.id === second.id)?.quantity.toString()).toBe("5");
    expect(holdings.find((holding) => holding.id === f.holding.id)?.investedValue?.toString()).toBe("1000");
    expect(holdings.find((holding) => holding.id === second.id)?.investedValue?.toString()).toBe("400");
    await expect(saveAssetAction({ id: f.asset.id, instrumentType: "MUTUAL_FUND", investmentClass: "STORE_OF_VALUE", ticker: "FUNDO", name: "Nome atualizado", quantity: 25, unitPrice: 104, investedValue: 1_400, investedValueCurrency: "BRL" }))
      .rejects.toThrow("mais de uma posição manual");
    await expect(importPortfolioRowsAction({ ...parsed, marketRows: parsed.marketRows.map((row) => ({ ...row, holdingId: undefined })) }))
      .rejects.toThrow("mais de uma posição manual");
    expect(await db!.assetHolding.count({ where: { assetId: f.asset.id } })).toBe(2);
  });

  it("rejeita IDs de outro usuário ou de posição externa", async () => {
    const f = await fixture();
    const other = await fixture();
    currentUser.id = f.user.id;
    const row = { instrumentType: "MUTUAL_FUND" as const, investmentClass: "STORE_OF_VALUE" as const, ticker: "FUNDO", name: "Fundo manual", quantity: 20, unitPrice: 100 };
    await expect(importPortfolioRowsAction({ marketRows: [{ ...row, holdingId: other.holding.id }], fixedIncomeRows: [] }))
      .rejects.toThrow("não pertencem");
    await db!.assetHolding.update({ where: { id: f.holding.id }, data: { positionSource: "BINANCE" } });
    await expect(importPortfolioRowsAction({ marketRows: [{ ...row, holdingId: f.holding.id }], fixedIncomeRows: [] }))
      .rejects.toThrow("não pertencem");
    expect((await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } })).quantity.toString()).toBe("20");
  });

  it("custos omitidos preservam o existente, explícitos alteram o par e null limpa ambos", async () => {
    const f = await fixture();
    const input = {
      id: f.asset.id, instrumentType: "MUTUAL_FUND" as const, investmentClass: "STORE_OF_VALUE" as const,
      ticker: f.asset.ticker, name: "Nome corrigido", quantity: 20, unitPrice: 100,
    };
    await saveAssetAction(input);
    let holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.investedValue?.toString()).toBe("1000");
    expect(holding.investedValueCurrency).toBe("BRL");
    await saveAssetAction({ ...input, investedValue: 200, investedValueCurrency: "USD" });
    holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.investedValue?.toString()).toBe("200");
    expect(holding.investedValueCurrency).toBe("USD");
    await saveAssetAction({ ...input, investedValue: null });
    holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.investedValue).toBeNull();
    expect(holding.investedValueCurrency).toBeNull();
  });

  it("importação sem custo não troca o custo pago pelo valor atual", async () => {
    const f = await fixture();
    await importPortfolioRowsAction({
      marketRows: [{ instrumentType: "MUTUAL_FUND", investmentClass: "STORE_OF_VALUE", ticker: "FUNDO", name: "Fundo manual", quantity: 20, unitPrice: 150, manualValue: 3_000 }],
      fixedIncomeRows: [],
    });
    const stored = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(stored.investedValue?.toString()).toBe("1000");
    expect(stored.investedValueCurrency).toBe("BRL");
    expect(stored.currentValue?.toString()).toBe("3000");
  });

  it("novo ativo sem custo mantém o custo desconhecido", async () => {
    const f = await fixture();
    await saveAssetAction({ investmentClass: "STORE_OF_VALUE", instrumentType: "MUTUAL_FUND", ticker: "NOVO", name: "Novo fundo", quantity: 10, unitPrice: 100 });
    const created = await db!.assetHolding.findFirstOrThrow({ where: { asset: { portfolioId: f.user.portfolio!.id, ticker: "NOVO" } } });
    expect(created.investedValue).toBeNull();
    expect(created.investedValueCurrency).toBeNull();
  });

  it.each([
    { currency: "BRL", cost: 1_000, expected: "1100" },
    { currency: "USD", cost: 100, expected: "120" },
    { currency: null, cost: null, expected: undefined },
  ])("aporte internacional respeita a base de custo $currency", async ({ currency, cost, expected }) => {
    const f = await fixture(cost);
    await db!.assetHolding.update({
      where: { id: f.holding.id },
      data: { currency: "USD", investedValueCurrency: currency },
    });
    const simulation = await db!.contributionSimulation.create({
      data: {
        userId: f.user.id, portfolioVersion: f.user.portfolio!.version, allocationMethod: "IMPROVED", inputAmount: 100, requestedAmount: 100, unallocatedAmount: 0,
        suggestions: { create: { assetId: f.asset.id, quantity: 2, value: 100, suggestionPercentage: 100, totalAfterSuggestionPercentage: 100, nativeCurrency: "USD", nativeUnitPrice: 10, nativeValue: 20, fxRateToBrl: 5 } },
      },
      include: { suggestions: true },
    });
    await expect(executeContributionAction(simulation.id, simulation.suggestions[0].id, 2, 10)).resolves.toMatchObject({ status: "EXECUTED", awaitingSync: false });
    const holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } });
    expect(holding.quantity.toString()).toBe("22");
    expect(holding.investedValue?.toString()).toBe(expected);
    expect(holding.investedValueCurrency).toBe(currency);
  });

  it("preserva isolamento de grupos e fingerprints RF nacionais e internacionais no mesmo lote", async () => {
    const f = await fixture();
    const code = `cost-${randomUUID()}`;
    familyCodes.push(code);
    const family = await db!.fixedIncomeFamily.create({ data: { code, name: "Família de teste", shortCode: `COST-${randomUUID().slice(0, 8)}` } });
    const groups = await Promise.all((["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"] as const).map((investmentClass) => db!.asset.create({
      data: { portfolioId: f.user.portfolio!.id, investmentClass, instrumentType: "FIXED_INCOME", ticker: "GRUPO", name: "Grupo de teste", fixedIncomeFamilyCode: family.code, indexation: "PRE_FIXED", score: 3 },
    })));
    const holding = { customTypeName: "Depósito de teste", issuer: "Banco teste", productName: "Aplicação homônima", currentValue: 1_000, investedValue: 800, investedValueCurrency: "BRL" };
    const fixedIncomeRows = (["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"] as const).map((investmentClass) => ({ investmentClass, familyCode: code, indexation: "PRE_FIXED" as const, score: 3, holding }));
    await importPortfolioRowsAction({ marketRows: [], fixedIncomeRows });
    await importPortfolioRowsAction({ marketRows: [], fixedIncomeRows });
    for (const group of groups) {
      const holdings = await db!.assetHolding.findMany({ where: { assetId: group.id } });
      expect(holdings).toHaveLength(1);
      expect(holdings[0].investedValue?.toString()).toBe("800");
      expect(holdings[0].investedValueCurrency).toBe("BRL");
      await saveAssetHoldingAction(group.id, { ...holding, id: holdings[0].id, investedValue: undefined, investedValueCurrency: undefined, currentValue: 1_200 });
      const stored = await db!.assetHolding.findUniqueOrThrow({ where: { id: holdings[0].id } });
      expect(stored.investedValue?.toString()).toBe("800");
    }
  });
});
