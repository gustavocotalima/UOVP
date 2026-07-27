import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { reconcilePluggyInvestmentsForUser } from "@/features/open-finance/diagram-sync";
import {
  classifyFinanceTransactionsForUser,
  learnFinanceClassificationRule,
} from "@/features/finance/classification-service";
import { PLUGGY_DIAGRAM_EXCLUSION_REASON } from "@/features/open-finance/diagram-exclusion";

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
  let firstFinancialAccountId = "";
  let secondFinanceTagId = "";
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
    firstFinancialAccountId = financialAccount.id;
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
    const secondTag = await db!.financeTag.create({
      data: {
        userId: second.id,
        name: `Tag isolada ${suffix}`,
        color: "#123456",
      },
    });
    secondFinanceTagId = secondTag.id;
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

  it("classifica transações Pluggy sem sobrescrever escolhas manuais", async () => {
    const automatic = await db!.financeTransaction.create({
      data: {
        userId: firstUserId,
        accountId: firstFinancialAccountId,
        source: "PLUGGY",
        externalId: `classification-auto-${suffix}`,
        kind: "EXPENSE",
        description: "Mercado de teste",
        providerCategory: "Groceries",
        amount: -50,
        date: new Date("2099-01-11T12:00:00.000Z"),
        referenceYear: 2099,
        referenceMonth: 1,
      },
    });
    const manual = await db!.financeTransaction.create({
      data: {
        userId: firstUserId,
        accountId: firstFinancialAccountId,
        source: "PLUGGY",
        externalId: `classification-manual-${suffix}`,
        kind: "EXPENSE",
        description: "Curso definido manualmente",
        providerCategory: "Online Courses",
        amount: -100,
        date: new Date("2099-01-12T12:00:00.000Z"),
        referenceYear: 2099,
        referenceMonth: 1,
        budgetCategory: "GOALS",
        budgetCategorySource: "MANUAL",
      },
    });

    await classifyFinanceTransactionsForUser(firstUserId, [automatic.id, manual.id]);
    const [classifiedAutomatic, classifiedManual] = await Promise.all([
      db!.financeTransaction.findUniqueOrThrow({ where: { id: automatic.id }, include: { tags: { include: { tag: true } } } }),
      db!.financeTransaction.findUniqueOrThrow({ where: { id: manual.id } }),
    ]);

    expect(classifiedAutomatic.budgetCategory).toBe("FIXED_COSTS");
    expect(classifiedAutomatic.budgetCategorySource).toBe("PROVIDER_DEFAULT");
    expect(classifiedAutomatic.tags.map((item) => item.tag.systemKey)).toContain("FOOD");
    expect(classifiedManual.budgetCategory).toBe("GOALS");
    expect(classifiedManual.budgetCategorySource).toBe("MANUAL");
  });

  it("rejeita tag de outro usuário em regra pessoal", async () => {
    const rule = await db!.financeClassificationRule.create({
      data: {
        userId: firstUserId,
        matchType: "DESCRIPTION",
        matchValue: `REGRA ${suffix}`,
        matchLabel: `Regra ${suffix}`,
        kind: "EXPENSE",
        assignsTags: true,
      },
    });
    await expect(db!.financeClassificationRuleTag.create({
      data: { ruleId: rule.id, tagId: secondFinanceTagId },
    })).rejects.toThrow();
  });

  it("aplica, limpa e remove uma regra exata sem alterar a decisão manual", async () => {
    const merchantCnpj = `12.345.678/0001-${suffix.slice(-2).padStart(2, "0")}`;
    const [manual, similar] = await Promise.all([
      db!.financeTransaction.create({
        data: {
          userId: firstUserId,
          accountId: firstFinancialAccountId,
          source: "PLUGGY",
          externalId: `rule-manual-${suffix}`,
          kind: "EXPENSE",
          description: "Compra semelhante A",
          merchantCnpj,
          providerCategory: "Shopping",
          amount: -70,
          date: new Date("2099-01-13T12:00:00.000Z"),
          referenceYear: 2099,
          referenceMonth: 1,
        },
      }),
      db!.financeTransaction.create({
        data: {
          userId: firstUserId,
          accountId: firstFinancialAccountId,
          source: "PLUGGY",
          externalId: `rule-similar-${suffix}`,
          kind: "EXPENSE",
          description: "Compra semelhante B",
          merchantCnpj,
          providerCategory: "Shopping",
          amount: -80,
          date: new Date("2099-01-14T12:00:00.000Z"),
          referenceYear: 2099,
          referenceMonth: 1,
        },
      }),
    ]);

    await classifyFinanceTransactionsForUser(firstUserId, [manual.id, similar.id]);
    await db!.financeTransaction.update({
      where: { id: manual.id },
      data: { budgetCategory: null, budgetCategorySource: "MANUAL" },
    });
    const rule = await learnFinanceClassificationRule(firstUserId, manual.id, {
      budgetCategory: null,
    });
    await classifyFinanceTransactionsForUser(firstUserId, [manual.id, similar.id]);
    await classifyFinanceTransactionsForUser(firstUserId, [manual.id, similar.id]);

    const [manualAfterRule, similarAfterRule] = await Promise.all([
      db!.financeTransaction.findUniqueOrThrow({ where: { id: manual.id } }),
      db!.financeTransaction.findUniqueOrThrow({ where: { id: similar.id } }),
    ]);
    expect(manualAfterRule.budgetCategory).toBeNull();
    expect(manualAfterRule.budgetCategorySource).toBe("MANUAL");
    expect(similarAfterRule.budgetCategory).toBeNull();
    expect(similarAfterRule.budgetCategorySource).toBe("USER_RULE");
    expect(similarAfterRule.classificationRuleId).toBe(rule?.id);

    await db!.financeClassificationRule.delete({ where: { id: rule!.id } });
    await classifyFinanceTransactionsForUser(firstUserId, [manual.id, similar.id]);
    const [manualAfterDelete, similarAfterDelete] = await Promise.all([
      db!.financeTransaction.findUniqueOrThrow({ where: { id: manual.id } }),
      db!.financeTransaction.findUniqueOrThrow({ where: { id: similar.id } }),
    ]);
    expect(manualAfterDelete.budgetCategory).toBeNull();
    expect(manualAfterDelete.budgetCategorySource).toBe("MANUAL");
    expect(similarAfterDelete.budgetCategory).toBe("COMFORT");
    expect(similarAfterDelete.budgetCategorySource).toBe("PROVIDER_DEFAULT");
    expect(similarAfterDelete.classificationRuleId).toBeNull();
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

    const reconnectedLink = firstLinks.find((link) => link.assetHoldingId);
    expect(reconnectedLink?.assetHoldingId).toBeTruthy();
    await db!.$transaction([
      db!.pluggyInvestmentDiagramLink.update({
        where: { id: reconnectedLink!.id },
        data: {
          status: "EXCLUDED",
          classificationSource: "USER_OVERRIDE",
          reviewReason: PLUGGY_DIAGRAM_EXCLUSION_REASON.CONNECTION_REMOVE,
        },
      }),
      db!.assetHolding.update({
        where: { id: reconnectedLink!.assetHoldingId! },
        data: { includedInTotals: false },
      }),
    ]);

    await reconcilePluggyInvestmentsForUser(firstUserId);
    const reactivated = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({
      where: { id: reconnectedLink!.id },
      include: { holding: true },
    });
    expect(reactivated.status).toBe("MAPPED");
    expect(reactivated.reviewReason).toBeNull();
    expect(reactivated.holding?.includedInTotals).toBe(true);

    await db!.$transaction([
      db!.pluggyInvestmentDiagramLink.update({
        where: { id: reconnectedLink!.id },
        data: {
          status: "EXCLUDED",
          reviewReason: PLUGGY_DIAGRAM_EXCLUSION_REASON.USER,
        },
      }),
      db!.assetHolding.update({
        where: { id: reconnectedLink!.assetHoldingId! },
        data: { includedInTotals: false },
      }),
    ]);

    await reconcilePluggyInvestmentsForUser(firstUserId);
    const stillExcluded = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({
      where: { id: reconnectedLink!.id },
      include: { holding: true },
    });
    expect(stillExcluded.status).toBe("EXCLUDED");
    expect(stillExcluded.reviewReason).toBe(PLUGGY_DIAGRAM_EXCLUSION_REASON.USER);
    expect(stillExcluded.holding?.includedInTotals).toBe(false);
  });
});
