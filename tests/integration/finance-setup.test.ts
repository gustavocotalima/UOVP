import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { ensureFinanceSetup, repairFinanceSetup } from "@/features/finance/setup";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("reparo idempotente da configuração financeira", () => {
  const userIds: string[] = [];
  async function user() {
    const row = await db!.user.create({ data: { email: `finance-setup-${randomUUID()}@example.com` } });
    userIds.push(row.id);
    return row;
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("a simulação não provisiona um usuário legado", async () => {
    const owner = await user();
    const plan = await db!.$transaction((tx) => repairFinanceSetup(tx, owner.id));
    expect(plan.createProfile).toBe(true);
    expect(plan.createGoals).toHaveLength(6);
    expect(plan.createTags).toHaveLength(6);
    expect(await db!.financeProfile.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db!.financeGoal.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db!.financeTag.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("repara sem sobrescrever perfil, meta personalizada ou tag legada associada", async () => {
    const owner = await user();
    const profile = await db!.financeProfile.create({
      data: { userId: owner.id, monthlyIncome: 12_345, financialMonthStart: 15, objectives: "Objetivo personalizado" },
    });
    const goal = await db!.financeGoal.create({ data: { userId: owner.id, category: "FIXED_COSTS", percentage: 42 } });
    const food = await db!.financeTag.create({ data: { userId: owner.id, name: "Alimentação", color: "#112233" } });
    const account = await db!.financialAccount.create({
      data: { userId: owner.id, source: "MANUAL", type: "BANK_ACCOUNT", name: "Conta de teste" },
    });
    const transaction = await db!.financeTransaction.create({
      data: {
        userId: owner.id, accountId: account.id, source: "MANUAL", kind: "EXPENSE",
        description: "Compra classificada", amount: -10, currencyCode: "BRL",
        reportingAmountBrl: -10, date: new Date("2026-10-01T12:00:00Z"),
        referenceYear: 2026, referenceMonth: 10,
        tags: { create: { tagId: food.id } },
      },
    });

    await ensureFinanceSetup(owner.id);
    const second = await ensureFinanceSetup(owner.id);

    expect(second).toEqual({ createProfile: false, createGoals: [], createTags: [], restoreTagKeys: [], conflicts: [] });
    expect(await db!.financeProfile.findUnique({ where: { userId: owner.id } })).toEqual(profile);
    expect(await db!.financeGoal.findUnique({ where: { id: goal.id } })).toEqual(goal);
    expect(await db!.financeTag.findUnique({ where: { id: food.id } })).toMatchObject({
      id: food.id, systemKey: "FOOD", name: "Alimentação", color: "#112233",
    });
    expect(await db!.financeTransactionTag.count({ where: { transactionId: transaction.id, tagId: food.id } })).toBe(1);
    expect(await db!.financeGoal.count({ where: { userId: owner.id } })).toBe(6);
    expect(await db!.financeTag.count({ where: { userId: owner.id } })).toBe(6);
  });

  it("serializa reparos concorrentes sem duplicar configurações e isola usuários", async () => {
    const [owner, other] = await Promise.all([user(), user()]);
    await Promise.all([ensureFinanceSetup(owner.id), ensureFinanceSetup(owner.id), ensureFinanceSetup(owner.id)]);
    expect(await db!.financeProfile.count({ where: { userId: owner.id } })).toBe(1);
    expect(await db!.financeGoal.count({ where: { userId: owner.id } })).toBe(6);
    expect(await db!.financeTag.count({ where: { userId: owner.id } })).toBe(6);
    expect(await db!.financeProfile.count({ where: { userId: other.id } })).toBe(0);
    expect(await db!.financeGoal.count({ where: { userId: other.id } })).toBe(0);
    expect(await db!.financeTag.count({ where: { userId: other.id } })).toBe(0);
  });

  it("preserva uma colisão de nome e relata a necessidade de decisão manual", async () => {
    const owner = await user();
    const existing = await db!.financeTag.create({
      data: { userId: owner.id, systemKey: "HOME", name: "Alimentação", color: "#112233" },
    });
    const plan = await ensureFinanceSetup(owner.id);
    expect(plan.conflicts).toEqual([{
      id: existing.id, name: "Alimentação", systemKey: "FOOD", existingSystemKey: "HOME",
    }]);
    expect(await db!.financeTag.findUnique({ where: { id: existing.id } })).toEqual(existing);
    expect(await db!.financeTag.count({ where: { userId: owner.id, name: "Alimentação" } })).toBe(1);
    expect(await db!.financeTag.count({ where: { userId: owner.id, systemKey: "FOOD" } })).toBe(0);
  });
});
