import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("isolamento entre usuários", () => {
  const suffix = Date.now().toString();
  let firstUserId = "";
  let secondUserId = "";
  let firstAssetId = "";
  let secondQuestionId = "";
  let secondSimulationId = "";
  let firstBudgetMonthId = "";
  let secondRecurringExpenseId = "";

  beforeAll(async () => {
    const first = await db!.user.create({ data: { email: `vitest-a-${suffix}@example.com`, portfolio: { create: {} } }, include: { portfolio: true } });
    const second = await db!.user.create({ data: { email: `vitest-b-${suffix}@example.com`, portfolio: { create: {} } }, include: { portfolio: true } });
    firstUserId = first.id;
    secondUserId = second.id;
    const asset = await db!.asset.create({
      data: {
        portfolioId: first.portfolio!.id,
        investmentClass: "BRAZILIAN_STOCKS",
        instrumentType: "STOCK",
        ticker: "TEST3",
        name: "Teste",
        score: 1,
        holdings: { create: { issuer: "Teste", productName: "Teste", pricingSource: "MANUAL", quantity: 1, unitPrice: 10 } },
      },
    });
    firstAssetId = asset.id;
    const question = await db!.diagramQuestion.create({
      data: {
        userId: second.id,
        type: "CERRADO",
        criterion: "TESTE",
        text: "Pergunta de isolamento entre usuários?",
      },
    });
    secondQuestionId = question.id;
    const simulation = await db!.contributionSimulation.create({
      data: {
        userId: second.id,
        portfolioVersion: second.portfolio!.version,
        requestedAmount: 100,
        unallocatedAmount: 100,
      },
    });
    secondSimulationId = simulation.id;
    const budget = await db!.budgetMonth.create({
      data: { userId: first.id, year: 2099, month: 1, income: 1_000 },
    });
    firstBudgetMonthId = budget.id;
    const recurring = await db!.recurringExpense.create({
      data: {
        userId: second.id,
        name: "Despesa isolada",
        amount: 10,
        category: "FIXED_COSTS",
      },
    });
    secondRecurringExpenseId = recurring.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: [firstUserId, secondUserId] } } });
    await db.$disconnect();
  });

  it("não encontra ativo de outro usuário ao aplicar o escopo", async () => {
    const visible = await db!.asset.findMany({ where: { portfolio: { userId: secondUserId } } });
    expect(visible).toHaveLength(0);
  });

  it("rejeita resposta que relaciona ativo e pergunta de usuários diferentes", async () => {
    await expect(db!.assetQuestionAnswer.create({
      data: { assetId: firstAssetId, questionId: secondQuestionId, answer: true },
    })).rejects.toThrow();
  });

  it("rejeita sugestão que relaciona simulação e ativo de usuários diferentes", async () => {
    await expect(db!.contributionSuggestion.create({
      data: {
        simulationId: secondSimulationId,
        assetId: firstAssetId,
        quantity: 1,
        value: 10,
        suggestionPercentage: 10,
        totalAfterSuggestionPercentage: 10,
      },
    })).rejects.toThrow();
  });

  it("rejeita despesa recorrente ligada ao orçamento de outro usuário", async () => {
    await expect(db!.expense.create({
      data: {
        budgetMonthId: firstBudgetMonthId,
        recurringExpenseId: secondRecurringExpenseId,
        name: "Tentativa cruzada",
        amount: 10,
        category: "FIXED_COSTS",
        spentAt: new Date(),
      },
    })).rejects.toThrow();
  });

  it("não mantém a tabela de backup financeiro após a migração", async () => {
    const [result] = await db!.$queryRaw<Array<{ tableName: string | null }>>`
      SELECT to_regclass('"AssetMigrationBackup"')::text AS "tableName"
    `;
    expect(result?.tableName).toBeNull();
  });
});
