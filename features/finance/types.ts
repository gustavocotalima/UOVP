import type { BudgetCategoryKey } from "@/features/budget/constants";

export type FinanceTagDto = {
  id: string;
  systemKey: string | null;
  name: string;
  color: string;
};

export type FinanceAssignmentSourceDto = "UNASSIGNED" | "PROVIDER_DEFAULT" | "USER_RULE" | "MANUAL";

export type FinanceClassificationRuleDto = {
  id: string;
  matchType: "MERCHANT_CNPJ" | "MERCHANT_NAME" | "COUNTERPARTY_NAME" | "DESCRIPTION" | "PROVIDER_CATEGORY";
  matchValue: string;
  matchLabel: string;
  kind: "INCOME" | "EXPENSE";
  assignsBudgetCategory: boolean;
  budgetCategory: BudgetCategoryKey | null;
  assignsTags: boolean;
  assignsInternalTransfer: boolean;
  internalTransfer: boolean;
  enabled: boolean;
  tags: FinanceTagDto[];
  appliedCount: number;
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
  descriptionRaw: string | null;
  merchantName: string | null;
  merchantBusinessName: string | null;
  merchantCnpj: string | null;
  merchantCategory: string | null;
  counterpartyName: string | null;
  paymentMethod: string | null;
  amount: string;
  currencyCode: string;
  date: string;
  referenceYear: number;
  referenceMonth: number;
  budgetCategory: BudgetCategoryKey | null;
  budgetCategorySource: FinanceAssignmentSourceDto;
  tagAssignmentSource: FinanceAssignmentSourceDto;
  providerCategory: string | null;
  providerCategoryId: string | null;
  status: string | null;
  note: string | null;
  ignored: boolean;
  internalTransfer: boolean;
  internalTransferSource: FinanceAssignmentSourceDto;
  installmentNumber: number | null;
  installmentTotal: number | null;
  classificationRule: { id: string; matchLabel: string } | null;
  classifiedAt: string | null;
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
  classificationRules: FinanceClassificationRuleDto[];
  unclassifiedTransactionCount: number;
  pluggy: {
    configured: boolean;
    itemCount: number;
    pendingCount: number;
    lastSyncAt: string | null;
  };
};
