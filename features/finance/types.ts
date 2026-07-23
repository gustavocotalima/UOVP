import type { BudgetCategoryKey } from "@/features/budget/constants";

export type FinanceTagDto = {
  id: string;
  name: string;
  color: string;
};

export type FinancialAccountDto = {
  id: string;
  source: "PLUGGY" | "MANUAL";
  type: "BANK_ACCOUNT" | "CREDIT_CARD";
  subtype: string | null;
  name: string;
  institutionName: string | null;
  institutionImageUrl: string | null;
  accountNumber: string | null;
  agency: string | null;
  numberLastFour: string | null;
  bankCode: string | null;
  brand: string | null;
  balance: string;
  creditLimit: string | null;
  availableCredit: string | null;
  dueDay: number | null;
  closingDay: number | null;
  currencyCode: string;
  sortOrder: number;
  providerUpdatedAt: string | null;
};

export type FinanceTransactionDto = {
  id: string;
  accountId: string;
  accountName: string;
  accountType: FinancialAccountDto["type"];
  accountImageUrl: string | null;
  institutionName: string | null;
  source: "PLUGGY" | "MANUAL";
  kind: "INCOME" | "EXPENSE";
  description: string;
  merchantName: string | null;
  amount: string;
  currencyCode: string;
  date: string;
  referenceYear: number;
  referenceMonth: number;
  budgetCategory: BudgetCategoryKey | null;
  providerCategory: string | null;
  status: string | null;
  note: string | null;
  ignored: boolean;
  internalTransfer: boolean;
  installmentNumber: number | null;
  installmentTotal: number | null;
  tags: FinanceTagDto[];
};

export type FinanceGoalRecord = Record<BudgetCategoryKey, number>;

export type FinanceData = {
  year: number;
  month: number;
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
  };
  profile: {
    monthlyIncome: string;
    financialMonthStart: number;
    objectives: string | null;
  };
  goals: FinanceGoalRecord;
  accounts: FinancialAccountDto[];
  transactions: FinanceTransactionDto[];
  recentTransactions: FinanceTransactionDto[];
  historyTransactions: FinanceTransactionDto[];
  tags: FinanceTagDto[];
  pluggy: {
    configured: boolean;
    itemCount: number;
    pendingCount: number;
    lastSyncAt: string | null;
  };
};
