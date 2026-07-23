import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { reconcilePluggyInvestmentsForUser } from "@/features/open-finance/diagram-sync";

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
  let firstFinanceTransactionId = "";
  let firstPluggyItemId = "";

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
    const financialAccount = await db!.financialAccount.create({
      data: {
        userId: first.id,
        source: "MANUAL",
        type: "BANK_ACCOUNT",
        name: "Conta isolada",
      },
    });
    const financeTransaction = await db!.financeTransaction.create({
      data: {
        userId: first.id,
        accountId: financialAccount.id,
        source: "MANUAL",
        kind: "EXPENSE",
        description: "Transação isolada",
        amount: -10,
        date: new Date("2099-01-10T12:00:00.000Z"),
        referenceYear: 2099,
        referenceMonth: 1,
      },
    });
    firstFinanceTransactionId = financeTransaction.id;
    const pluggyItem = await db!.pluggyItem.create({
      data: {
        userId: first.id,
        pluggyItemId: `pluggy-item-${suffix}`,
        connectorName: "Banco de teste",
        institutionName: "Banco de teste",
        status: "UPDATED",
        syncPending: false,
        investments: {
          create: [
            {
              pluggyInvestmentId: `pluggy-active-${suffix}`,
              name: "Empresa isolada",
              code: "ISOX3",
              type: "EQUITY",
              subtype: "STOCK",
              balance: 100,
              value: 10,
              quantity: 10,
              status: "ACTIVE",
            },
            {
              pluggyInvestmentId: `pluggy-zero-${suffix}`,
              name: "Empresa ativa sem saldo",
              code: "ZERO3",
              type: "EQUITY",
              subtype: "STOCK",
              balance: 0,
              value: 0,
              quantity: 0,
              status: "ACTIVE",
            },
            {
              pluggyInvestmentId: `pluggy-sold-${suffix}`,
              name: "Empresa totalmente resgatada",
              code: "SOLD3",
              type: "EQUITY",
              subtype: "STOCK",
              balance: 0,
              value: 0,
              quantity: 0,
              status: "TOTAL_WITHDRAWAL",
            },
          ],
        },
      },
    });
    firstPluggyItemId = pluggyItem.id;
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

  it("isola contas, transações, tags e metas financeiras por usuário", async () => {
    const [accounts, transactions] = await Promise.all([
      db!.financialAccount.findMany({ where: { userId: secondUserId } }),
      db!.financeTransaction.findMany({ where: { userId: secondUserId } }),
    ]);
    expect(accounts).toHaveLength(0);
    expect(transactions).toHaveLength(0);
    const changed = await db!.financeTransaction.updateMany({
      where: { id: firstFinanceTransactionId, userId: secondUserId },
      data: { ignored: true },
    });
    expect(changed.count).toBe(0);
  });

  it("reconcilia posições Pluggy de forma idempotente e isolada por usuário", async () => {
    await reconcilePluggyInvestmentsForUser(firstUserId);
    await reconcilePluggyInvestmentsForUser(firstUserId);

    const [firstLinks, firstPluggyHoldings, secondLinks, soldLink] = await Promise.all([
      db!.pluggyInvestmentDiagramLink.findMany({ where: { userId: firstUserId } }),
      db!.assetHolding.findMany({
        where: {
          positionSource: "PLUGGY",
          asset: { portfolio: { userId: firstUserId } },
        },
      }),
      db!.pluggyInvestmentDiagramLink.findMany({ where: { userId: secondUserId } }),
      db!.pluggyInvestmentDiagramLink.findFirst({
        where: {
          investment: {
            pluggyItemDbId: firstPluggyItemId,
            status: "TOTAL_WITHDRAWAL",
          },
        },
      }),
    ]);

    expect(firstLinks).toHaveLength(2);
    expect(firstPluggyHoldings).toHaveLength(2);
    expect(firstLinks.every((link) => link.status === "MAPPED")).toBe(true);
    expect(secondLinks).toHaveLength(0);
    expect(soldLink).toBeNull();
  });
});
