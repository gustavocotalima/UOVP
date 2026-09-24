import { describe, expect, it } from "vitest";
import { calculateDailyExpenses } from "@/features/finance/daily-expenses";
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

describe("calendário de saídas brutas", () => {
  function september(overrides: Partial<FinanceTransactionDto> = {}) {
    return transaction({
      date: "2026-09-08T12:00:00.000Z",
      referenceYear: 2026,
      referenceMonth: 9,
      budgetCategory: null,
      ...overrides,
    });
  }

  it("mostra o reinvestimento integral e concilia a grade com os lançamentos fora do mês", () => {
    const transactions = [
      september({ id: "income", kind: "INCOME", amount: "20.46" }),
      september({ id: "dividend", kind: "INCOME", amount: "540.60", budgetCategory: "FINANCIAL_FREEDOM" }),
      september({ id: "reinvestment", amount: "-540.60", budgetCategory: "FINANCIAL_FREEDOM", date: "2026-09-09T12:00:00Z" }),
      september({ id: "expenses", amount: "-635.15" }),
      september({ id: "installment", amount: "-44.25", date: "2026-08-15T12:00:00Z", accountType: "CREDIT_CARD" }),
    ];
    const calendar = calculateDailyExpenses(transactions, 2026, 9, "America/Sao_Paulo");
    expect(calendar.totalCents).toBe(122000);
    expect(calendar.totalCents / 100).toBe(calculatePeriod(transactions).grossExpenses);
    expect(calculatePeriod(transactions).spent).toBe(679.40);
    expect(calendar.inCalendarCents).toBe(117575);
    expect(calendar.outsideCents).toBe(4425);
    expect(calendar.outsideEntries.map((entry) => entry.transaction.id)).toEqual(["installment"]);
    expect(calendar.days[8].entries[0]).toMatchObject({ grossCents: 54060 });
    expect(calendar.days[8].totalCents).toBe(54060);
    expect(calendar.daysWithExpenses).toBe(2);
    expect(calendar.daysWithoutExpenses).toBe(28);
    expect(calendar.averageCents).toBe(3919);
    expect(calendar.peakDay?.day).toBe(8);
  });

  it("não inclui ocultas, transferências internas, removidas ou sem conversão", () => {
    const calendar = calculateDailyExpenses([
      september({ id: "valid", amount: "-10" }),
      september({ id: "ignored", amount: "-900", ignored: true }),
      september({ id: "transfer", amount: "-800", internalTransfer: true }),
      september({ id: "removed", amount: "-700", providerLifecycle: "REMOVED" }),
      september({ id: "missing-fx", amount: "-600", currencyCode: "USD", reportingAmountBrl: null }),
    ], 2026, 9, "America/Sao_Paulo");
    expect(calendar.totalCents).toBe(1000);
    expect(calendar.days[7].entries.map((entry) => entry.transaction.id)).toEqual(["valid"]);
  });

  it("mostra o valor BRL integral de uma saída USD mesmo com compensação na meta", () => {
    const transactions = [
      september({ id: "bolt", description: "BOLT", amount: "-1.74", currencyCode: "USD", reportingAmountBrl: "-9.03", budgetCategory: "FIXED_COSTS" }),
      september({ id: "offset", kind: "INCOME", amount: "1.60", budgetCategory: "FIXED_COSTS" }),
    ];
    const calendar = calculateDailyExpenses(transactions, 2026, 9, "America/Sao_Paulo");
    expect(calendar.totalCents).toBe(903);
    expect(calendar.days[7].entries[0]).toMatchObject({ grossCents: 903 });
    expect(calendar.days[7].entries[0].transaction.amount).toBe("-1.74");
    expect(calculatePeriod(transactions).spent).toBe(7.43);
  });

  it("usa o fuso do usuário e preserva datas sem horário", () => {
    const transactions = [
      september({ id: "august-local", amount: "-10", date: "2026-09-01T01:30:00Z" }),
      september({ id: "september-local", amount: "-20", date: "2026-10-01T01:30:00Z" }),
      september({ id: "date-only", amount: "-30", date: "2026-09-01" }),
    ];
    const calendar = calculateDailyExpenses(transactions, 2026, 9, "America/Sao_Paulo");
    expect(calendar.days[0].totalCents).toBe(3000);
    expect(calendar.days[29].totalCents).toBe(2000);
    expect(calendar.outsideCents).toBe(1000);
    const utc = calculateDailyExpenses(transactions, 2026, 9, "UTC");
    expect(utc.days[0].totalCents).toBe(4000);
    expect(utc.outsideCents).toBe(2000);
  });

  it("não compensa metas ou meses diferentes e ignora outro mês de referência", () => {
    const calendar = calculateDailyExpenses([
      september({ id: "expense", amount: "-100", budgetCategory: "FINANCIAL_FREEDOM" }),
      september({ id: "other-goal", kind: "INCOME", amount: "200", budgetCategory: "COMFORT" }),
      september({ id: "other-month", kind: "INCOME", amount: "300", budgetCategory: "FINANCIAL_FREEDOM", referenceMonth: 8 }),
      september({ id: "next-invoice", amount: "-500", referenceMonth: 10 }),
    ], 2026, 9, "America/Sao_Paulo");
    expect(calendar.totalCents).toBe(10000);
    expect(calendar.days[7].entries).toHaveLength(1);
  });

  it("mantém saídas diárias brutas e distribui a compensação entre tags sem perder centavos", () => {
    const food = { id: "food", systemKey: "FOOD", name: "Alimentação", color: "#ff0000" };
    const leisure = { ...food, id: "leisure", systemKey: "LEISURE", name: "Lazer" };
    const transactions = [
      september({ id: "refund", kind: "INCOME", amount: "0.01", budgetCategory: "COMFORT" }),
      ...[8, 9, 10].map((day) => september({
        id: `expense-${day}`,
        amount: "-0.01",
        date: `2026-09-${String(day).padStart(2, "0")}T12:00:00Z`,
        budgetCategory: "COMFORT",
        tags: [food, leisure],
      })),
    ];
    const calendar = calculateDailyExpenses(transactions, 2026, 9, "UTC");
    const tags = calculateTagTotals(transactions, [food, leisure]);
    expect(calendar.totalCents).toBe(3);
    expect(calendar.days.reduce((sum, day) => sum + day.totalCents, 0)).toBe(3);
    expect(tags.reduce((sum, tag) => sum + Math.round(tag.value * 100), 0)).toBe(3);
    expect(tags.reduce((sum, tag) => sum + Math.round(tag.compensated * 100), 0)).toBe(1);
    expect(tags.reduce((sum, tag) => sum + Math.round(tag.net * 100), 0)).toBe(2);
    expect(calculatePeriod(transactions).spent).toBe(0.02);
  });

  it("calcula meses vazios, alinhamento semanal, fevereiro bissexto e virada do ano", () => {
    const septemberCalendar = calculateDailyExpenses([], 2026, 9, "UTC");
    expect(septemberCalendar.days).toHaveLength(30);
    expect(septemberCalendar.firstWeekday).toBe(2);
    expect(septemberCalendar.averageCents).toBe(0);
    expect(septemberCalendar.peakDay).toBeNull();
    expect(septemberCalendar.daysWithoutExpenses).toBe(30);
    expect(calculateDailyExpenses([], 2028, 2, "UTC").days).toHaveLength(29);
    expect(calculateDailyExpenses([], 2027, 2, "UTC").days).toHaveLength(28);
    expect(calculateDailyExpenses([], 2027, 1, "UTC").days[0].date).toBe("2027-01-01");
  });

  it("ordena detalhes por valor e mantém lançamentos sem data válida fora da grade", () => {
    const calendar = calculateDailyExpenses([
      september({ id: "small", amount: "-1" }),
      september({ id: "large", amount: "-20" }),
      september({ id: "invalid-date", amount: "-3", date: "invalid" }),
    ], 2026, 9, "UTC");
    expect(calendar.days[7].entries.map((entry) => entry.transaction.id)).toEqual(["large", "small"]);
    expect(calendar.totalCents).toBe(2400);
    expect(calendar.outsideCents).toBe(300);
  });
});

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
      { id: "food", name: "Alimentação", color: "#ef4444", value: 50, compensated: 0, net: 50 },
      { id: "untagged", name: "Sem Tags", color: "#64748b", value: 25, compensated: 0, net: 25 },
    ]);
  });

  it("mostra gastos brutos por tag e separa a parcela compensada sem duplicar multitag", () => {
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
      { id: "investments", name: "Investimentos", color: "#16a34a", value: 50, compensated: 25, net: 25 },
      { id: "goals", name: "Metas", color: "#7c3aed", value: 50, compensated: 25, net: 25 },
      { id: "untagged", name: "Sem Tags", color: "#64748b", value: 25, compensated: 0, net: 25 },
    ]);
    expect(result.reduce((total, item) => total + item.value, 0)).toBe(125);
    expect(result.reduce((total, item) => total + item.compensated, 0)).toBe(50);
    expect(result.reduce((total, item) => total + item.net, 0)).toBe(75);
  });

  it("não aplica a compensação de outra meta ou mês ao segmento de uma tag", () => {
    const food = { id: "food", systemKey: "FOOD", name: "Alimentação", color: "#ef4444" };
    const result = calculateTagTotals([
      transaction({ id: "expense", amount: "-10", budgetCategory: "COMFORT", tags: [food] }),
      transaction({ id: "other-goal", kind: "INCOME", amount: "10", budgetCategory: "GOALS" }),
      transaction({ id: "other-month", kind: "INCOME", amount: "10", budgetCategory: "COMFORT", referenceMonth: 8 }),
    ], [food]);
    expect(result).toEqual([
      { id: "food", name: "Alimentação", color: "#ef4444", value: 10, compensated: 0, net: 10 },
    ]);
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
