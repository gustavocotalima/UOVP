import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { calculateHoldingAveragePrice, summarizePurchaseTransactions, type AveragePriceTransaction } from "@/features/portfolio/average-price";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("resumos transacionais de compras Pluggy", () => {
  const userIds: string[] = [];

  async function fixture() {
    const suffix = randomUUID();
    const user = await db!.user.create({ data: { email: `vitest-purchases-${suffix}@example.com` } });
    userIds.push(user.id);
    const item = await db!.pluggyItem.create({
      data: { userId: user.id, pluggyItemId: `summary-item-${suffix}`, connectorName: "Teste", status: "UPDATED" },
    });
    const data = {
      pluggyItemDbId: item.id, name: "ITUB3", type: "EQUITY", subtype: "STOCK", quantity: 10,
    };
    const first = await db!.pluggyInvestment.create({ data: { ...data, pluggyInvestmentId: `summary-first-${suffix}` } });
    const second = await db!.pluggyInvestment.create({ data: { ...data, pluggyInvestmentId: `summary-second-${suffix}` } });
    return { user, first, second };
  }

  function movement(investmentId: string, values: Partial<Prisma.PluggyInvestmentTransactionUncheckedCreateInput> = {}) {
    return {
      pluggyInvestmentDbId: investmentId, pluggyInvestmentTransactionId: `summary-movement-${randomUUID()}`,
      type: "BUY", quantity: 2, value: 11, amount: 20, netAmount: 18,
      date: new Date("2026-10-01T12:00:00.000Z"), ...values,
    };
  }

  async function expectSummary(id: string, quantity: string, cost: string) {
    const result = await db!.pluggyInvestment.findUniqueOrThrow({ where: { id } });
    expect(result.purchaseQuantityTotal.toString()).toBe(quantity);
    expect(result.purchaseCostTotal.toString()).toBe(cost);
    expect(result.purchaseSummaryVersion).toBe(1);
    return result;
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("versiona históricos vazios e mantém insert/upsert repetido/update/delete sem dupla contagem", async () => {
    const f = await fixture();
    await expectSummary(f.first.id, "0", "0");
    const data = movement(f.first.id);
    const operation = await db!.pluggyInvestmentTransaction.create({ data });
    await expectSummary(f.first.id, "2", "18");
    for (let repeat = 0; repeat < 2; repeat++) {
      await db!.pluggyInvestmentTransaction.upsert({
        where: { pluggyInvestmentTransactionId: data.pluggyInvestmentTransactionId }, create: data, update: data,
      });
    }
    await expectSummary(f.first.id, "2", "18");
    await db!.pluggyInvestmentTransaction.update({
      where: { id: operation.id }, data: { quantity: -3, netAmount: null, amount: null, value: -12, type: "buy" },
    });
    await expectSummary(f.first.id, "3", "36");
    await db!.pluggyInvestmentTransaction.update({ where: { id: operation.id }, data: { type: "SELL" } });
    await expectSummary(f.first.id, "0", "0");
    await db!.pluggyInvestmentTransaction.update({ where: { id: operation.id }, data: { type: "BUY" } });
    await db!.pluggyInvestmentTransaction.delete({ where: { id: operation.id } });
    const summary = await expectSummary(f.first.id, "0", "0");
    expect(summary.updatedAt).toEqual(f.first.updatedAt);
    expect(summary.providerUpdatedAt).toEqual(f.first.providerUpdatedAt);
  });

  it("zera um snapshot removido por deleteMany e mantém rollback de todos os deltas", async () => {
    const f = await fixture();
    await db!.pluggyInvestmentTransaction.createMany({ data: [movement(f.first.id), movement(f.first.id)] });
    await expectSummary(f.first.id, "4", "36");
    await expect(db!.$transaction(async (tx) => {
      await tx.pluggyInvestmentTransaction.deleteMany({ where: { pluggyInvestmentDbId: f.first.id } });
      await tx.pluggyInvestmentTransaction.create({ data: movement(f.first.id, { quantity: 100 }) });
      throw new Error("Rollback intencional");
    })).rejects.toThrow("Rollback intencional");
    await expectSummary(f.first.id, "4", "36");
    await db!.pluggyInvestmentTransaction.deleteMany({ where: { pluggyInvestmentDbId: f.first.id } });
    await expectSummary(f.first.id, "0", "0");
  });

  it("transfere o delta entre investimentos e permite exclusão em cascata do pai", async () => {
    const f = await fixture();
    const operation = await db!.pluggyInvestmentTransaction.create({ data: movement(f.first.id) });
    await db!.pluggyInvestmentTransaction.update({
      where: { id: operation.id }, data: { pluggyInvestmentDbId: f.second.id, netAmount: 22 },
    });
    await expectSummary(f.first.id, "0", "0");
    await expectSummary(f.second.id, "2", "22");
    await db!.pluggyInvestment.delete({ where: { id: f.second.id } });
    expect(await db!.pluggyInvestmentTransaction.findUnique({ where: { id: operation.id } })).toBeNull();
    await expectSummary(f.first.id, "0", "0");
  });

  it("serializa compras concorrentes sem perder deltas", async () => {
    const f = await fixture();
    await Promise.all(Array.from({ length: 12 }, () =>
      db!.pluggyInvestmentTransaction.create({ data: movement(f.first.id) })));
    await expectSummary(f.first.id, "24", "216");
  });

  it("reparentings concorrentes em sentidos opostos usam ordem estável dos pais", async () => {
    const f = await fixture();
    const first = await db!.pluggyInvestmentTransaction.create({ data: movement(f.first.id) });
    const second = await db!.pluggyInvestmentTransaction.create({ data: movement(f.second.id, { quantity: 3, netAmount: 42 }) });
    await Promise.all([
      db!.pluggyInvestmentTransaction.update({ where: { id: first.id }, data: { pluggyInvestmentDbId: f.second.id } }),
      db!.pluggyInvestmentTransaction.update({ where: { id: second.id }, data: { pluggyInvestmentDbId: f.first.id } }),
    ]);
    await expectSummary(f.first.id, "3", "42");
    await expectSummary(f.second.id, "2", "18");
  });

  it("preserva a quantidade efetiva e a prioridade do valor original na leitura do resumo", async () => {
    const f = await fixture();
    await db!.pluggyInvestmentTransaction.create({
      data: movement(f.first.id, { quantity: 100, value: 24.98, amount: 2498, netAmount: null }),
    });
    const stored = await expectSummary(f.first.id, "100", "2498");
    const purchaseSummary = {
      version: stored.purchaseSummaryVersion, quantity: stored.purchaseQuantityTotal.toString(), cost: stored.purchaseCostTotal.toString(),
    };
    const result = calculateHoldingAveragePrice({ positionSource: "PLUGGY", quantity: 125, investedValue: null, providerCurrency: "BRL", purchaseSummary });
    expect(result.price?.toString()).toBe("24.98");
    expect(result.coverage).toBe(0.8);
    expect(calculateHoldingAveragePrice({
      positionSource: "PLUGGY", quantity: 125, investedValue: null, amountOriginal: 5000, providerCurrency: "BRL", purchaseSummary,
    }).price?.toString()).toBe("40");
    await expectSummary(f.first.id, "100", "2498");
  });

  const cases: AveragePriceTransaction[] = [
    { type: "buy", quantity: -2, value: 90, amount: -50, netAmount: -48 },
    { type: "BUY", quantity: 3, value: -10, amount: 0, netAmount: "NaN" },
    { type: "BUY", quantity: 2, value: 90, amount: 0, netAmount: null },
    { type: "BUY", quantity: 1, value: 99, amount: 8, netAmount: "Infinity" },
    { type: "BUY", quantity: "NaN", value: 100, amount: 100, netAmount: null },
    { type: "BUY", quantity: 10, value: "Infinity", amount: null, netAmount: null },
    { type: "BUY", quantity: 0, value: 100, amount: 100, netAmount: 100 },
    { type: "BUY", quantity: 2, value: null, amount: null, netAmount: null },
    { type: "BUY", quantity: null, value: null, amount: null, netAmount: null },
    { type: " BUY ", quantity: 10, value: 100, amount: 100, netAmount: null },
    { type: "SELL", quantity: 999, value: 100, amount: 99900, netAmount: null },
    { type: "BUY", quantity: "1000000000.0000000001", value: "1234567890.123456789", amount: null, netAmount: null },
  ];
  it.each(cases)("a função SQL tem a mesma contribuição que a fórmula TS: %j", async (transaction) => {
    const rows = await db!.$queryRaw<Array<{ quantity: Prisma.Decimal; cost: Prisma.Decimal }>>(Prisma.sql`
      SELECT purchase_quantity AS quantity, purchase_cost AS cost
      FROM uovp_purchase_summary_entry(
        ${transaction.type}::TEXT, ${transaction.quantity?.toString() ?? null}::NUMERIC,
        ${transaction.value?.toString() ?? null}::NUMERIC, ${transaction.amount?.toString() ?? null}::NUMERIC,
        ${transaction.netAmount?.toString() ?? null}::NUMERIC
      )
    `);
    const summary = summarizePurchaseTransactions([transaction]);
    expect(rows[0].quantity.toString()).toBe(summary.quantity?.toString());
    expect(rows[0].cost.toString()).toBe(summary.cost?.toString());
  });
});
