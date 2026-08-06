import { describe, expect, it } from "vitest";
import {
  calculateAccountTotals,
  calculateBudgetCategories,
  calculateHistory,
  calculateInvoices,
  calculatePeriod,
  calculateTagTotals,
  needsFinanceClassification,
  resolveFinancialReference,
} from "@/features/finance/calculations";
import type { FinanceGoalRecord, FinanceTransactionDto, FinancialAccountDto } from "@/features/finance/types";

const goals: FinanceGoalRecord = {
  FIXED_COSTS: 30,
  COMFORT: 15,
  GOALS: 15,
  PLEASURES: 10,
  FINANCIAL_FREEDOM: 25,
  KNOWLEDGE: 5,
};

const bank: FinancialAccountDto = {
  id: "bank",
  source: "MANUAL",
  type: "BANK_ACCOUNT",
  subtype: "CHECKING_ACCOUNT",
  name: "Banco",
  institutionName: "Banco",
  institutionImageUrl: null,
  accountNumber: "123",
  agency: "1",
  numberLastFour: "0123",
  bankCode: null,
  brand: null,
  balance: "1200",
  balanceBrl: "1200",
  balanceFxRateToBrl: "1",
  balanceFxRateDate: "2026-07-10T00:00:00.000Z",
  balanceFxSource: "NATIVE",
  balanceSnapshotAt: null,
  creditLimit: null,
  availableCredit: null,
  dueDay: null,
  closingDay: null,
  currencyCode: "BRL",
  sortOrder: 0,
  providerUpdatedAt: null,
  transactionCount: 0,
};

const card: FinancialAccountDto = {
  ...bank,
  id: "card",
  type: "CREDIT_CARD",
  name: "Cartão",
  balance: "400",
  balanceBrl: "400",
  creditLimit: "2000",
  availableCredit: "1600",
  dueDay: 14,
  closingDay: 7,
};

function transaction(overrides: Partial<FinanceTransactionDto> = {}): FinanceTransactionDto {
  const result: FinanceTransactionDto = {
    id: "txn",
    accountId: bank.id,
    accountName: bank.name,
    accountType: bank.type,
    accountImageUrl: null,
    institutionName: bank.institutionName,
    source: "PLUGGY",
    kind: "EXPENSE",
    description: "Transação",
    descriptionRaw: null,
    merchantName: null,
    merchantBusinessName: null,
    merchantCnpj: null,
    merchantCategory: null,
    counterpartyName: null,
    paymentMethod: null,
    amount: "-100",
    currencyCode: "BRL",
    reportingAmountBrl: "-100",
    fxRateToBrl: "1",
    fxRateDate: "2026-07-10T00:00:00.000Z",
    fxSource: "NATIVE",
    originalAmount: null,
    originalCurrencyCode: null,
    date: "2026-07-10T12:00:00.000Z",
    referenceYear: 2026,
    referenceMonth: 7,
    budgetCategory: "FIXED_COSTS",
    budgetCategorySource: "MANUAL",
    tagAssignmentSource: "UNASSIGNED",
    providerCategory: null,
    providerCategoryId: null,
    status: null,
    note: null,
    ignored: false,
    updateAccountBalance: false,
    providerLifecycle: "ACTIVE",
    providerDeletedAt: null,
    internalTransfer: false,
    internalTransferSource: "UNASSIGNED",
    installmentNumber: null,
    installmentTotal: null,
    classificationRule: null,
    classifiedAt: null,
    tags: [],
    ...overrides,
  };
  result.reportingAmountBrl = overrides.reportingAmountBrl === undefined
    ? result.amount
    : overrides.reportingAmountBrl;
  return result;
}

describe("finanças AUVP", () => {
  it("identifica apenas despesas visíveis e não internas sem classificação", () => {
    expect(needsFinanceClassification(transaction({
      budgetCategory: null,
      budgetCategorySource: "UNASSIGNED",
    }))).toBe(true);
    expect(needsFinanceClassification(transaction({
      budgetCategory: null,
      budgetCategorySource: "UNASSIGNED",
      ignored: true,
    }))).toBe(false);
    expect(needsFinanceClassification(transaction({
      budgetCategory: null,
      budgetCategorySource: "UNASSIGNED",
      internalTransfer: true,
    }))).toBe(false);
    expect(needsFinanceClassification(transaction({
      kind: "INCOME",
      budgetCategory: null,
      budgetCategorySource: "UNASSIGNED",
    }))).toBe(false);
  });

  it("calcula renda, gastos e saldo ignorando ocultas e transferências internas", () => {
    const result = calculatePeriod([
      transaction({ id: "income", kind: "INCOME", amount: "1000" }),
      transaction({ id: "expense", amount: "-250" }),
      transaction({ id: "ignored", amount: "-500", ignored: true }),
      transaction({ id: "internal", amount: "-200", internalTransfer: true }),
    ]);
    expect(result).toEqual({
      income: 1000,
      grossIncome: 1000,
      budgetBaseIncome: 0,
      grossExpenses: 250,
      compensatedExpenses: 250,
      spent: 0,
      balance: 0,
      missingFxCount: 0,
    });
  });

  it("mantém transações históricas nos relatórios mesmo sem aplicá-las ao saldo", () => {
    const result = calculatePeriod([
      transaction({
        id: "historical",
        source: "MANUAL",
        amount: "-75",
        updateAccountBalance: false,
      }),
    ]);
    expect(result.grossExpenses).toBe(75);
    expect(result.spent).toBe(75);
  });

  it("compensa reinvestimentos no resumo sem retirar as entradas brutas", () => {
    const result = calculatePeriod([
      transaction({ id: "base-income", kind: "INCOME", amount: "20.46", budgetCategory: null }),
      transaction({ id: "dividend", kind: "INCOME", amount: "540.60", budgetCategory: "FINANCIAL_FREEDOM" }),
      transaction({ id: "reinvestment", amount: "-540.60", budgetCategory: "FINANCIAL_FREEDOM" }),
      transaction({ id: "other-expenses", amount: "-635.15", budgetCategory: null }),
    ]);
    expect(result.grossIncome).toBeCloseTo(561.06);
    expect(result.budgetBaseIncome).toBeCloseTo(20.46);
    expect(result.grossExpenses).toBeCloseTo(1175.75);
    expect(result.compensatedExpenses).toBeCloseTo(540.60);
    expect(result.spent).toBeCloseTo(635.15);
    expect(result.balance).toBeCloseTo(-614.69);
  });

  it.each([
    { income: 100, expense: 300, compensated: 100, spent: 200 },
    { income: 300, expense: 300, compensated: 300, spent: 0 },
    { income: 500, expense: 300, compensated: 300, spent: 0 },
  ])("limita a compensação a cada meta ($income de entrada)", ({ income, expense, compensated, spent }) => {
    const result = calculatePeriod([
      transaction({ id: "income", kind: "INCOME", amount: String(income), budgetCategory: "COMFORT" }),
      transaction({ id: "expense", amount: String(-expense), budgetCategory: "COMFORT" }),
    ]);
    expect(result.compensatedExpenses).toBe(compensated);
    expect(result.spent).toBe(spent);
    expect(result.balance).toBe(spent === 0 ? 0 : -spent);
  });

  it("não compensa transações de metas ou meses diferentes", () => {
    const result = calculatePeriod([
      transaction({ id: "income-other-goal", kind: "INCOME", amount: "100", budgetCategory: "COMFORT" }),
      transaction({ id: "expense", amount: "-100", budgetCategory: "PLEASURES" }),
      transaction({ id: "income-other-month", kind: "INCOME", amount: "50", budgetCategory: "PLEASURES", referenceMonth: 6 }),
    ]);
    expect(result.compensatedExpenses).toBe(0);
    expect(result.spent).toBe(100);
    expect(result.balance).toBe(-100);
  });

  it("desconta entradas categorizadas do valor realizado na mesma meta", () => {
    const categories = calculateBudgetCategories(
      [
        transaction({ id: "expense", amount: "-300" }),
        transaction({ id: "income", kind: "INCOME", amount: "100", budgetCategory: "FIXED_COSTS" }),
      ],
      goals,
      1000,
    );
    const fixed = categories.find((item) => item.category === "FIXED_COSTS");
    expect(fixed?.spent).toBe(200);
    expect(fixed?.expenses).toBe(300);
    expect(fixed?.incomeOffsets).toBe(100);
    expect(fixed?.appliedIncomeOffsets).toBe(100);
    expect(fixed?.target).toBe(300);
    expect(fixed?.transactions).toHaveLength(2);
  });

  it("calcula somente o aumento líquido ao reinvestir um resgate", () => {
    const categories = calculateBudgetCategories(
      [
        transaction({
          id: "reinvestment",
          amount: "-30000",
          budgetCategory: "FINANCIAL_FREEDOM",
        }),
        transaction({
          id: "redemption",
          kind: "INCOME",
          amount: "26399.73",
          budgetCategory: "FINANCIAL_FREEDOM",
        }),
      ],
      goals,
      10000,
    );
    const freedom = categories.find((item) => item.category === "FINANCIAL_FREEDOM");
    expect(freedom?.spent).toBeCloseTo(3600.27);
    expect(freedom?.incomeOffsets).toBeCloseTo(26399.73);
    expect(freedom?.appliedIncomeOffsets).toBeCloseTo(26399.73);
  });

  it("agrupa despesas por tag e conserva o total sem tags", () => {
    const tags = [{ id: "food", systemKey: "FOOD", name: "Alimentação", color: "#ef4444" }];
    const result = calculateTagTotals(
      [
        transaction({ id: "food", amount: "-50", tags }),
        transaction({ id: "none", amount: "-25" }),
        transaction({ id: "income", kind: "INCOME", amount: "100", budgetCategory: null, tags }),
      ],
      tags,
    );
    expect(result).toEqual([
      { id: "food", name: "Alimentação", color: "#ef4444", value: 50 },
      { id: "untagged", name: "Sem Tags", color: "#64748b", value: 25 },
    ]);
  });

  it("distribui despesas líquidas entre tags sem duplicar transações multitag", () => {
    const tags = [
      { id: "investments", systemKey: null, name: "Investimentos", color: "#16a34a" },
      { id: "goals", systemKey: null, name: "Metas", color: "#7c3aed" },
    ];
    const result = calculateTagTotals([
      transaction({ id: "offset", kind: "INCOME", amount: "50", budgetCategory: "FINANCIAL_FREEDOM" }),
      transaction({ id: "tagged", amount: "-100", budgetCategory: "FINANCIAL_FREEDOM", tags }),
      transaction({ id: "untagged", amount: "-25", budgetCategory: null }),
    ], tags);
    expect(result).toEqual([
      { id: "investments", name: "Investimentos", color: "#16a34a", value: 25 },
      { id: "goals", name: "Metas", color: "#7c3aed", value: 25 },
      { id: "untagged", name: "Sem Tags", color: "#64748b", value: 25 },
    ]);
    expect(result.reduce((total, item) => total + item.value, 0)).toBe(75);
  });

  it("calcula saldo bancário, dívida dos cartões e resultado", () => {
    expect(calculateAccountTotals([bank, card])).toEqual({
      bankBalance: 1200,
      cardDebt: 400,
      result: 800,
      missingFxCount: 0,
    });
  });

  it("consolida contas e cartões USD pelos equivalentes em BRL", () => {
    const usdBank: FinancialAccountDto = {
      ...bank,
      id: "usd-bank",
      currencyCode: "USD",
      balance: "1000",
      balanceBrl: "5250",
      balanceFxRateToBrl: "5.25",
      balanceFxSource: "YAHOO",
    };
    const usdCard: FinancialAccountDto = {
      ...card,
      id: "usd-card",
      currencyCode: "USD",
      balance: "100",
      balanceBrl: "525",
      balanceFxRateToBrl: "5.25",
      balanceFxSource: "YAHOO",
    };

    expect(calculateAccountTotals([usdBank, usdCard])).toEqual({
      bankBalance: 5250,
      cardDebt: 525,
      result: 4725,
      missingFxCount: 0,
    });
  });

  it("monta o histórico no mês de referência, não apenas pela data da transação", () => {
    const history = calculateHistory(
      [transaction({ id: "moved", amount: "-80", referenceMonth: 6 })],
      2026,
      7,
      3,
    );
    expect(history.map((item) => item.spent)).toEqual([0, 80, 0]);
  });

  it("aplica a compensação somente ao mês correspondente no histórico", () => {
    const history = calculateHistory([
      transaction({ id: "june-income", kind: "INCOME", amount: "1000", budgetCategory: null, referenceMonth: 6 }),
      transaction({ id: "june-expense", amount: "-200", budgetCategory: null, referenceMonth: 6 }),
      transaction({ id: "august-base", kind: "INCOME", amount: "20.46", budgetCategory: null, referenceMonth: 8 }),
      transaction({ id: "august-dividend", kind: "INCOME", amount: "540.60", budgetCategory: "FINANCIAL_FREEDOM", referenceMonth: 8 }),
      transaction({ id: "august-reinvestment", amount: "-540.60", budgetCategory: "FINANCIAL_FREEDOM", referenceMonth: 8 }),
      transaction({ id: "august-expenses", amount: "-635.15", budgetCategory: null, referenceMonth: 8 }),
    ], 2026, 8, 3);

    expect(history).toEqual([
      expect.objectContaining({ key: "2026-06", income: 1000, spent: 200, balance: 800 }),
      expect.objectContaining({ key: "2026-07", income: 0, spent: 0, balance: 0 }),
      expect.objectContaining({ key: "2026-08", income: 561.06, spent: 635.15, balance: -614.69 }),
    ]);
  });

  it.each([
    { id: "hidden", ignored: true },
    { id: "internal", internalTransfer: true },
    { id: "removed", providerLifecycle: "REMOVED" as const },
  ])("não usa uma entrada $id como compensação", (override) => {
    const result = calculatePeriod([
      transaction({
        ...override,
        kind: "INCOME",
        amount: "100",
        budgetCategory: "FINANCIAL_FREEDOM",
      }),
      transaction({ id: "expense", amount: "-100", budgetCategory: "FINANCIAL_FREEDOM" }),
    ]);
    expect(result.compensatedExpenses).toBe(0);
    expect(result.spent).toBe(100);
  });

  it("respeita o dia configurado para o início do mês financeiro", () => {
    expect(resolveFinancialReference(new Date("2026-07-09T12:00:00.000Z"), 10)).toEqual({ year: 2026, month: 6 });
    expect(resolveFinancialReference(new Date("2026-07-10T12:00:00.000Z"), 10)).toEqual({ year: 2026, month: 7 });
    expect(resolveFinancialReference(new Date("2026-01-02T12:00:00.000Z"), 5)).toEqual({ year: 2025, month: 12 });
  });

  it("agrupa compras do cartão na fatura do mês seguinte e usa o dia de vencimento", () => {
    const invoices = calculateInvoices(
      card,
      [transaction({ id: "card-txn", accountId: card.id, accountName: card.name, accountType: "CREDIT_CARD", amount: "-125" })],
      new Date("2026-07-20T12:00:00.000Z"),
    );
    const august = invoices.find((invoice) => invoice.key === "2026-08");
    expect(august?.open).toBe(true);
    expect(august?.total).toBe(125);
    expect(new Date(august!.dueDate).getUTCDate()).toBe(14);
  });

  it("coloca compras anteriores ao fechamento na fatura corrente", () => {
    const invoices = calculateInvoices(
      card,
      [transaction({ id: "before-close", accountId: card.id, accountName: card.name, accountType: "CREDIT_CARD", amount: "-50", date: "2026-07-04T12:00:00.000Z" })],
      new Date("2026-07-20T12:00:00.000Z"),
    );
    expect(invoices.find((invoice) => invoice.key === "2026-07")?.total).toBe(50);
  });

  it("usa o calendário do usuário perto da virada do dia", () => {
    const invoices = calculateInvoices(
      card,
      [transaction({
        id: "timezone-boundary",
        accountId: card.id,
        accountName: card.name,
        accountType: "CREDIT_CARD",
        amount: "-50",
        date: "2026-07-08T01:00:00.000Z",
      })],
      new Date("2026-07-20T12:00:00.000Z"),
      "America/Sao_Paulo",
    );
    expect(invoices.find((invoice) => invoice.key === "2026-07")?.total).toBe(50);
  });

  it("mantém fatura USD nativa e consolida seu equivalente em BRL", () => {
    const usdCard: FinancialAccountDto = {
      ...card,
      id: "usd-card",
      currencyCode: "USD",
      balance: "100",
      balanceBrl: "550",
      balanceFxRateToBrl: "5.5",
      balanceFxSource: "YAHOO",
    };
    const invoices = calculateInvoices(
      usdCard,
      [transaction({
        id: "usd-card-txn",
        accountId: usdCard.id,
        accountName: usdCard.name,
        accountType: "CREDIT_CARD",
        amount: "-100",
        currencyCode: "USD",
        reportingAmountBrl: "-550",
        fxRateToBrl: "5.5",
        fxSource: "YAHOO",
      })],
      new Date("2026-07-20T12:00:00.000Z"),
    );
    const august = invoices.find((invoice) => invoice.key === "2026-08");
    expect(august?.total).toBe(100);
    expect(august?.totalBrl).toBe(550);
  });

  it("exclui dos totais BRL apenas a transação sem conversão", () => {
    expect(calculatePeriod([
      transaction({ id: "converted", kind: "INCOME", amount: "100", reportingAmountBrl: "550", budgetCategory: null }),
      transaction({ id: "missing", amount: "-658600", currencyCode: "PYG", reportingAmountBrl: null }),
    ])).toEqual({
      income: 550,
      grossIncome: 550,
      budgetBaseIncome: 550,
      grossExpenses: 0,
      compensatedExpenses: 0,
      spent: 0,
      balance: 550,
      missingFxCount: 1,
    });
  });
});
