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
  creditLimit: null,
  availableCredit: null,
  dueDay: null,
  closingDay: null,
  currencyCode: "BRL",
  sortOrder: 0,
  providerUpdatedAt: null,
};

const card: FinancialAccountDto = {
  ...bank,
  id: "card",
  type: "CREDIT_CARD",
  name: "Cartão",
  balance: "400",
  creditLimit: "2000",
  availableCredit: "1600",
  dueDay: 14,
  closingDay: 7,
};

function transaction(overrides: Partial<FinanceTransactionDto> = {}): FinanceTransactionDto {
  return {
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
    internalTransfer: false,
    internalTransferSource: "UNASSIGNED",
    installmentNumber: null,
    installmentTotal: null,
    classificationRule: null,
    classifiedAt: null,
    tags: [],
    ...overrides,
  };
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
    expect(result).toEqual({ income: 1000, spent: 250, balance: 750 });
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
  });

  it("agrupa despesas por tag e conserva o total sem tags", () => {
    const tags = [{ id: "food", systemKey: "FOOD", name: "Alimentação", color: "#ef4444" }];
    const result = calculateTagTotals(
      [
        transaction({ id: "food", amount: "-50", tags }),
        transaction({ id: "none", amount: "-25" }),
        transaction({ id: "income", kind: "INCOME", amount: "100", tags }),
      ],
      tags,
    );
    expect(result).toEqual([
      { id: "food", name: "Alimentação", color: "#ef4444", value: 50 },
      { id: "untagged", name: "Sem Tags", color: "#64748b", value: 25 },
    ]);
  });

  it("calcula saldo bancário, dívida dos cartões e resultado", () => {
    expect(calculateAccountTotals([bank, card])).toEqual({ bankBalance: 1200, cardDebt: 400, result: 800 });
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
});
