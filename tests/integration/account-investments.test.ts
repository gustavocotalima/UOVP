import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { classifyAccountInvestment, projectAccountInvestment, setAccountInvestmentPreference } from "@/features/finance/account-investments";
import { accountInvestmentReviews } from "@/features/finance/account-investment-dto";
import { createFinanceTransactionAction, updateFinanceTransactionAction, deleteFinanceTransactionAction, saveFinancialAccountAction, deleteFinancialAccountAction } from "@/features/finance/actions";
import { getPortfolioData } from "@/features/portfolio/data";
import { executeContributionAction } from "@/features/portfolio/actions";
import { portfolioTools } from "@/features/mcp/portfolio-tools";
import { financeTools } from "@/features/mcp/finance-tools";
import type { McpContext } from "@/features/mcp/types";

const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => auth.userId }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("saldo de conta na Carteira", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const family = `ACCOUNT_TEST_${suffix}`;
  const users: string[] = [];
  let accountId = "";

  beforeAll(async () => {
    await db!.fixedIncomeFamily.create({ data: { code: family, name: "Saldo remunerado sem presunção de FGC", shortCode: `TEST-${suffix}` } });
  });
  beforeEach(async () => {
    const user = await db!.user.create({ data: { email: `account-investment-${suffix}-${users.length}@example.com`, portfolio: { create: {} } } });
    users.push(user.id);
    auth.userId = user.id;
    const account = await db!.financialAccount.create({ data: { userId: user.id, source: "MANUAL", type: "BANK_ACCOUNT", name: "Conta remunerada", balance: 1000, balanceBrl: 1000, currencyCode: "BRL" } });
    accountId = account.id;
  });
  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.fixedIncomeFamily.delete({ where: { code: family } });
    await db.$disconnect();
  });
  async function enable(id = accountId) {
    await db!.$transaction((tx) => setAccountInvestmentPreference(tx, auth.userId, id, true));
    return db!.accountInvestmentLink.findUniqueOrThrow({ where: { accountId: id } });
  }
  async function classify(id = accountId, currency = "BRL", score = 8) {
    const link = await enable(id);
    return db!.$transaction((tx) => classifyAccountInvestment(tx, auth.userId, {
      linkId: link.id, expectedUpdatedAt: link.updatedAt.toISOString(),
      investmentClass: currency === "USD" ? "INTERNATIONAL_FIXED_INCOME" : "FIXED_INCOME",
      familyCode: family, indexation: "OTHER", score,
    }));
  }
  async function holding(id = accountId) {
    return (await db!.accountInvestmentLink.findUniqueOrThrow({ where: { accountId: id }, include: { assetHolding: true } })).assetHolding!;
  }
  async function mutateBalance(balance: number, data: Prisma.FinancialAccountUpdateInput = {}) {
    await db!.$transaction(async (tx) => {
      await tx.financialAccount.update({ where: { id: accountId }, data: { balance, ...data } });
      await projectAccountInvestment(tx, accountId);
    });
  }
  async function transaction(amount: number, updateAccountBalance = true) {
    return createFinanceTransactionAction({ accountId, kind: amount > 0 ? "INCOME" : "EXPENSE", amount: Math.abs(amount), description: "Movimento de teste", date: "2026-10-17", referenceYear: 2026, referenceMonth: 10, updateAccountBalance, manualFxRateToBrl: 5 });
  }

  it("começa desativado, exige revisão e não altera saldo ou transações", async () => {
    expect(await db!.accountInvestmentLink.count({ where: { accountId } })).toBe(0);
    await enable();
    const reviews = await accountInvestmentReviews(db!, auth.userId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].source).toBe("ACCOUNT_BALANCE");
    expect(await db!.assetHolding.count({ where: { asset: { portfolio: { userId: auth.userId } } } })).toBe(0);
    const id = await classify();
    const row = await holding();
    expect(row.id).toBe(id);
    expect(row.currentValue?.toString()).toBe("1000");
    expect(row.investedValue).toBeNull();
    expect(row.positionSource).toBe("ACCOUNT_BALANCE");
    expect(row.includedInTotals).toBe(true);
    expect((await db!.financialAccount.findUniqueOrThrow({ where: { id: accountId } })).balance.toString()).toBe("1000");
    expect(await db!.financeTransaction.count({ where: { accountId } })).toBe(0);
    const dto = await getPortfolioData(auth.userId);
    expect(dto.assets[0].holdings[0].accountBalanceSource?.alsoIncludedInAccountBalance).toBe(true);
    expect(dto.integrationReview).toHaveLength(0);
  });

  it("reutiliza grupo sem sobrescrever nota e mantém uma posição por conta", async () => {
    await classify(accountId, "BRL", 12);
    const first = await holding();
    await classify(accountId, "BRL", 3);
    const account2 = await db!.financialAccount.create({ data: { userId: auth.userId, source: "MANUAL", type: "BANK_ACCOUNT", name: "Segunda conta", balance: 200 } });
    await classify(account2.id, "BRL", 1);
    expect((await holding(account2.id)).assetId).toBe(first.assetId);
    expect((await db!.asset.findUniqueOrThrow({ where: { id: first.assetId } })).score).toBe(12);
    expect(await db!.accountInvestmentLink.count({ where: { accountId } })).toBe(1);
  });

  it("desativar e reativar preserva classificação e vínculo", async () => {
    const id = await classify();
    await db!.$transaction((tx) => setAccountInvestmentPreference(tx, auth.userId, accountId, false));
    expect((await holding()).includedInTotals).toBe(false);
    await enable();
    expect((await holding()).id).toBe(id);
    expect((await holding()).includedInTotals).toBe(true);
  });

  it("reutiliza um grupo legado pelo vínculo de classificação, não só pelo ticker", async () => {
    const portfolio = await db!.portfolio.findUniqueOrThrow({ where: { userId: auth.userId } });
    const group = await db!.asset.create({ data: {
      portfolioId: portfolio.id, ticker: "GRUPO-LEGADO", name: "Nome personalizado do grupo",
      instrumentType: "FIXED_INCOME", investmentClass: "FIXED_INCOME", fixedIncomeFamilyCode: family, indexation: "OTHER", score: 15,
    } });
    await classify();
    expect((await holding()).assetId).toBe(group.id);
    const after = await db!.asset.findUniqueOrThrow({ where: { id: group.id } });
    expect(after.score).toBe(15);
    expect(after.name).toBe(group.name);
    expect(after.ticker).toBe("GRUPO-LEGADO");
  });

  it("zero/negativo mantém classificação, sem investimentos negativos", async () => {
    await classify();
    await mutateBalance(-50);
    expect((await holding()).currentValue?.toString()).toBe("0");
    expect((await holding()).includedInTotals).toBe(true);
    await mutateBalance(80);
    expect((await holding()).currentValue?.toString()).toBe("80");
  });

  it("novo saldo zero só abre revisão após ficar positivo", async () => {
    await mutateBalance(0);
    await enable();
    expect(await accountInvestmentReviews(db!, auth.userId)).toHaveLength(0);
    await mutateBalance(30);
    expect(await accountInvestmentReviews(db!, auth.userId)).toHaveLength(1);
  });

  it("entrada, saída, edição e exclusão refletem somente o saldo efetivo", async () => {
    await classify();
    await transaction(100);
    expect((await holding()).currentValue?.toString()).toBe("1100");
    await transaction(-50);
    expect((await holding()).currentValue?.toString()).toBe("1050");
    const expense = await db!.financeTransaction.findFirstOrThrow({ where: { accountId, kind: "EXPENSE" } });
    await updateFinanceTransactionAction({ id: expense.id, amount: 70, referenceYear: 2026, referenceMonth: 10, tagIds: [], updateAccountBalance: true });
    expect((await holding()).currentValue?.toString()).toBe("1030");
    await deleteFinanceTransactionAction(expense.id);
    expect((await holding()).currentValue?.toString()).toBe("1100");
    await transaction(500, false);
    expect((await holding()).currentValue?.toString()).toBe("1100");
    expect(await db!.financeTransaction.count({ where: { accountId, balanceApplied: false, deleted: false } })).toBe(1);
  });

  it("mover transação atualiza as duas posições", async () => {
    await classify();
    const other = await db!.financialAccount.create({ data: { userId: auth.userId, source: "MANUAL", type: "BANK_ACCOUNT", name: "Outra conta", balance: 200 } });
    await classify(other.id);
    await transaction(-40);
    const movement = await db!.financeTransaction.findFirstOrThrow({ where: { accountId } });
    await updateFinanceTransactionAction({ id: movement.id, accountId: other.id, referenceYear: 2026, referenceMonth: 10, tagIds: [], updateAccountBalance: true });
    expect((await holding()).currentValue?.toString()).toBe("1000");
    expect((await holding(other.id)).currentValue?.toString()).toBe("160");
  });

  it("correção manual altera projeção, e campo omitido preserva preferência", async () => {
    await classify();
    await saveFinancialAccountAction({ id: accountId, type: "BANK_ACCOUNT", name: "Conta renomeada", balance: 1200, expectedBalance: 1000, currencyCode: "BRL" });
    expect((await holding()).currentValue?.toString()).toBe("1200");
    expect((await holding()).productName).toBe("Conta renomeada");
    expect((await holding()).includedInTotals).toBe(true);
    await expect(saveFinancialAccountAction({ id: accountId, type: "BANK_ACCOUNT", name: "Conta antiga", balance: 1000, expectedBalance: 1000, currencyCode: "BRL" })).rejects.toThrow("saldo da conta mudou");
  });

  it("conta Pluggy permite preferência mas não libera saldo ou moeda", async () => {
    await db!.financialAccount.update({ where: { id: accountId }, data: { source: "PLUGGY" } });
    await saveFinancialAccountAction({ id: accountId, type: "BANK_ACCOUNT", name: "Nome personalizado", balance: 9000, currencyCode: "USD", classifyBalanceAsInvestment: true });
    const account = await db!.financialAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.balance.toString()).toBe("1000");
    expect(account.currencyCode).toBe("BRL");
    await classify();
    await mutateBalance(1300);
    expect((await holding()).currentValue?.toString()).toBe("1300");
  });

  it("cartão não pode ativar a preferência", async () => {
    await db!.financialAccount.update({ where: { id: accountId }, data: { type: "CREDIT_CARD" } });
    await expect(enable()).rejects.toThrow("Cartões");
  });

  it("USD usa câmbio corrente e mudança de moeda exige nova revisão", async () => {
    await classify();
    await mutateBalance(100, { currencyCode: "USD", balanceBrl: 500, balanceFxRateToBrl: 5 });
    expect((await holding()).includedInTotals).toBe(false);
    const link = await db!.accountInvestmentLink.findUniqueOrThrow({ where: { accountId } });
    expect(link.status).toBe("NEEDS_REVIEW");
    await classify(accountId, "USD");
    const dto = await getPortfolioData(auth.userId);
    const usdAsset = dto.assets.find((asset) => asset.investmentClass === "INTERNATIONAL_FIXED_INCOME")!;
    expect(usdAsset.nativeCurrentValue).toBe("100");
    expect(usdAsset.currentValue).toBe("500");
    await transaction(10);
    expect((await holding()).quantity.toString()).toBe("110");
    await mutateBalance(110, { balanceFxRateToBrl: null, balanceBrl: null });
    const missing = await getPortfolioData(auth.userId);
    const missingUsd = missing.assets.find((asset) => asset.investmentClass === "INTERNATIONAL_FIXED_INCOME")!;
    expect(missingUsd.holdings[0].accountBalanceSource?.valuationUnavailable).toBe(true);
    expect(missingUsd.nativeCurrentValue).toBe("110");
  });

  it("contas internacionais e nacionais nunca compartilham grupo", async () => {
    await classify();
    const usd = await db!.financialAccount.create({ data: { userId: auth.userId, source: "MANUAL", type: "BANK_ACCOUNT", name: "Conta USD", balance: 100, currencyCode: "USD", balanceFxRateToBrl: 5 } });
    await classify(usd.id, "USD");
    expect((await holding(usd.id)).assetId).not.toBe((await holding()).assetId);
  });

  it("aporte planejado só confirma após mudança nativa, não câmbio ou metadados", async () => {
    await mutateBalance(100, { currencyCode: "USD", balanceFxRateToBrl: 5 });
    const id = await classify(accountId, "USD");
    const row = await holding();
    const portfolio = await db!.portfolio.findUniqueOrThrow({ where: { userId: auth.userId } });
    const simulation = await db!.contributionSimulation.create({ data: {
      userId: auth.userId, portfolioVersion: portfolio.version, inputAmount: 100, requestedAmount: 100, unallocatedAmount: 0,
      suggestions: { create: { assetId: row.assetId, quantity: 100, value: 100, suggestionPercentage: 100, totalAfterSuggestionPercentage: 100, executionStatus: "AWAITING_SYNC", awaitingSyncAt: new Date(), externalBaselines: { create: { holdingId: id, quantity: 100, providerValue: 100, currency: "USD", fxRateToBrl: 5 } } } },
    }, include: { suggestions: true } });
    await mutateBalance(100, { balanceFxRateToBrl: 6 });
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: simulation.suggestions[0].id } })).executionStatus).toBe("AWAITING_SYNC");
    await mutateBalance(120);
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: simulation.suggestions[0].id } })).executionStatus).toBe("EXECUTED");
    expect((await holding()).quantity.toString()).toBe("120");
  });

  it("inativação e exclusão retiram a posição sem apagar investimentos de outra conta", async () => {
    await classify();
    await mutateBalance(1000, { active: false });
    expect((await holding()).includedInTotals).toBe(false);
    await mutateBalance(1000, { active: true });
    const id = (await holding()).id;
    await deleteFinancialAccountAction(accountId);
    expect((await db!.assetHolding.findUniqueOrThrow({ where: { id } })).includedInTotals).toBe(false);
    expect(await db!.financialAccount.findUnique({ where: { id: accountId } })).toBeNull();
  });

  it("rejeita acesso cruzado e revisão concorrente baseada em snapshot antigo", async () => {
    const link = await enable();
    const input = { linkId: link.id, expectedUpdatedAt: link.updatedAt.toISOString(), investmentClass: "FIXED_INCOME" as const, familyCode: family, indexation: "OTHER" as const, score: 1 };
    await expect(db!.$transaction((tx) => classifyAccountInvestment(tx, users[0] === auth.userId ? "outro-usuario" : users[0], input))).rejects.toThrow("não encontrado");
    await db!.$transaction((tx) => classifyAccountInvestment(tx, auth.userId, input));
    await expect(db!.$transaction((tx) => classifyAccountInvestment(tx, auth.userId, input))).rejects.toThrow("mudou");
  });

  it("planejar aporte não altera saldos nem cria transações", async () => {
    const id = await classify();
    const row = await holding();
    const portfolio = await db!.portfolio.findUniqueOrThrow({ where: { userId: auth.userId } });
    const simulation = await db!.contributionSimulation.create({ data: {
      userId: auth.userId, portfolioVersion: portfolio.version, inputAmount: 200, requestedAmount: 200, unallocatedAmount: 0,
      suggestions: { create: { assetId: row.assetId, quantity: 200, value: 200, suggestionPercentage: 100, totalAfterSuggestionPercentage: 100 } },
    }, include: { suggestions: true } });
    const result = await executeContributionAction(simulation.id, simulation.suggestions[0].id, 200, undefined, { holdingId: id });
    expect(result).toMatchObject({ awaitingSync: true });
    expect((await holding()).quantity.toString()).toBe("1000");
    expect((await db!.financialAccount.findUniqueOrThrow({ where: { id: accountId } })).balance.toString()).toBe("1000");
    expect(await db!.financeTransaction.count({ where: { accountId } })).toBe(0);
    await transaction(200);
    expect((await holding()).quantity.toString()).toBe("1200");
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: simulation.suggestions[0].id } })).executionStatus).toBe("EXECUTED");
  });

  it("transações concorrentes mantêm o mesmo saldo na conta e na Carteira", async () => {
    await classify();
    await Promise.all([transaction(50), transaction(-30)]);
    expect((await holding()).quantity.toString()).toBe("1020");
    expect((await db!.financialAccount.findUniqueOrThrow({ where: { id: accountId } })).balance.toString()).toBe("1020");
  });

  it("editar só a descrição não confirma aporte por um estorno intermediário", async () => {
    const id = await classify();
    await transaction(100);
    const movement = await db!.financeTransaction.findFirstOrThrow({ where: { accountId } });
    const row = await holding();
    const portfolio = await db!.portfolio.findUniqueOrThrow({ where: { userId: auth.userId } });
    const simulation = await db!.contributionSimulation.create({ data: {
      userId: auth.userId, portfolioVersion: portfolio.version, inputAmount: 200, requestedAmount: 200, unallocatedAmount: 0,
      suggestions: { create: { assetId: row.assetId, quantity: 200, value: 200, suggestionPercentage: 100, totalAfterSuggestionPercentage: 100 } },
    }, include: { suggestions: true } });
    await executeContributionAction(simulation.id, simulation.suggestions[0].id, 200, undefined, { holdingId: id });
    await updateFinanceTransactionAction({ id: movement.id, description: "Descrição corrigida", referenceYear: 2026, referenceMonth: 10, tagIds: [], updateAccountBalance: true });
    expect((await holding()).quantity.toString()).toBe("1100");
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: simulation.suggestions[0].id } })).executionStatus).toBe("AWAITING_SYNC");
    expect((await db!.portfolio.findUniqueOrThrow({ where: { userId: auth.userId } })).version).toBe(portfolio.version);
  });

  it("MCP identifica a sobreposição nos dois lados e conta revisões pendentes", async () => {
    const context: McpContext = { userId: auth.userId, clientId: "test-client", grantId: "test-grant", timeZone: "America/Sao_Paulo", scopes: ["portfolio:read", "accounts:read"] };
    await enable();
    const summary = portfolioTools.find((tool) => tool.name === "get_portfolio_summary")!;
    expect(await summary.execute(context, {})).toMatchObject({ pendingAccountBalanceReview: 1, totalValueBrl: "0" });
    const id = await classify();
    const result = await portfolioTools.find((tool) => tool.name === "list_holdings")!.execute(context, {});
    expect(result).toMatchObject({ holdings: [expect.objectContaining({ id, accountBalanceSource: expect.objectContaining({ accountId, sameMoneyAsAccountBalance: true }) })] });
    expect(await financeTools.find((tool) => tool.name === "list_accounts")!.execute(context, {})).toMatchObject({ data: { accounts: [expect.objectContaining({ id: accountId, portfolioOverlap: expect.objectContaining({ holdingId: id, sameMoneyAsAccountBalance: true }) })] } });
    const before = await db!.portfolio.findUniqueOrThrow({ where: { userId: auth.userId } });
    await summary.execute(context, {});
    expect((await db!.portfolio.findUniqueOrThrow({ where: { userId: auth.userId } })).version).toBe(before.version);
  });

  it("câmbio ausente é desconhecido no MCP, não um saldo BRL zero", async () => {
    await mutateBalance(100, { currencyCode: "USD", balanceFxRateToBrl: null, balanceBrl: null });
    await classify(accountId, "USD");
    const context: McpContext = { userId: auth.userId, clientId: "test-client", grantId: "test-grant", timeZone: "America/Sao_Paulo", scopes: ["portfolio:read"] };
    expect(await portfolioTools.find((tool) => tool.name === "get_portfolio_summary")!.execute(context, {})).toMatchObject({ complete: false, totalValueBrl: null, valuationIssues: [expect.objectContaining({ issue: "MISSING_FX" })] });
    expect(await portfolioTools.find((tool) => tool.name === "list_holdings")!.execute(context, {})).toMatchObject({ holdings: [expect.objectContaining({ nativeCurrentValue: "100", currentValueBrl: null })] });
  });

  it("reutiliza a taxa descritiva após sync sem calcular juros", async () => {
    const link = await enable();
    await db!.$transaction((tx) => classifyAccountInvestment(tx, auth.userId, {
      linkId: link.id, expectedUpdatedAt: link.updatedAt.toISOString(), investmentClass: "FIXED_INCOME", familyCode: family, indexation: "POST_FIXED", score: 8,
      rateConvention: "PERCENT_OF_INDEXER", benchmark: "CDI", rateValue: 110,
    }));
    await mutateBalance(1200);
    const row = await holding();
    expect(row.rateValue?.toString()).toBe("110");
    expect(row.currentValue?.toString()).toBe("1200");
    expect(row.investedValue).toBeNull();
    expect(await db!.financeTransaction.count({ where: { accountId } })).toBe(0);
  });

  it("saldo automático da mesma conta exige confirmação explícita; Caixinha não é duplicata", async () => {
    const id = await classify();
    const item = await db!.pluggyItem.create({ data: { userId: auth.userId, pluggyItemId: `overlap-${suffix}`, connectorName: "Banco", status: "UPDATED" } });
    const raw = await db!.pluggyAccount.create({ data: { pluggyItemDbId: item.id, pluggyAccountId: `account-overlap-${suffix}`, type: "BANK", name: "Conta" } });
    await db!.financialAccount.update({ where: { id: accountId }, data: { externalId: raw.pluggyAccountId } });
    const position = await db!.pluggyInvestment.create({ data: { pluggyItemDbId: item.id, pluggyAccountDbId: raw.id, pluggyInvestmentId: `auto-${suffix}`, source: "ACCOUNT_AUTOMATIC_BALANCE", name: "Saldo automático", type: "FIXED_INCOME", balance: 1000, status: "ACTIVE", providerAvailable: true } });
    const duplicate = await db!.assetHolding.create({ data: { assetId: (await holding()).assetId, issuer: "Banco", productName: "Saldo automático", pricingSource: "PLUGGY", positionSource: "PLUGGY", currentValue: 1000 } });
    await db!.pluggyInvestmentDiagramLink.create({ data: { userId: auth.userId, pluggyInvestmentDbId: position.id, assetHoldingId: duplicate.id, status: "MAPPED" } });
    const link = await db!.accountInvestmentLink.findUniqueOrThrow({ where: { accountId } });
    const input = { linkId: link.id, expectedUpdatedAt: link.updatedAt.toISOString(), investmentClass: "FIXED_INCOME" as const, familyCode: family, indexation: "OTHER" as const, score: 1 };
    await expect(db!.$transaction((tx) => classifyAccountInvestment(tx, auth.userId, input))).rejects.toThrow("saldo automático");
    await db!.$transaction((tx) => classifyAccountInvestment(tx, auth.userId, { ...input, confirmDistinctAutomaticBalance: true }));
    expect((await holding()).id).toBe(id);
    expect((await db!.assetHolding.findUniqueOrThrow({ where: { id: duplicate.id } })).includedInTotals).toBe(true);
  });
});
