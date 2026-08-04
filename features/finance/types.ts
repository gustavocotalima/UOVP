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
  matchType: "MERCHANT_CNPJ" | "MERCHANT_NAME" | "COUNTERPARTY_NAME" | "DESCRIPTION" | "DESCRIPTION_PREFIX" | "PROVIDER_CATEGORY";
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
  balanceBrl: string | null;
  balanceFxRateToBrl: string | null;
  balanceFxRateDate: string | null;
  balanceFxSource: "NATIVE" | "PLUGGY" | "YAHOO" | "MANUAL" | null;
  creditLimit: string | null;
  availableCredit: string | null;
  dueDay: number | null;
  closingDay: number | null;
  currencyCode: string;
  sortOrder: number;
  providerUpdatedAt: string | null;
  transactionCount: number;
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
  reportingAmountBrl: string | null;
  fxRateToBrl: string | null;
  fxRateDate: string | null;
  fxSource: "NATIVE" | "PLUGGY" | "YAHOO" | "MANUAL" | null;
  originalAmount: string | null;
  originalCurrencyCode: string | null;
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
  providerLifecycle: "ACTIVE" | "DELETION_PENDING" | "KEPT_MANUAL" | "REMOVED" | null;
  providerDeletedAt: string | null;
  internalTransfer: boolean;
  internalTransferSource: FinanceAssignmentSourceDto;
  installmentNumber: number | null;
  installmentTotal: number | null;
  classificationRule: { id: string; matchLabel: string } | null;
  classifiedAt: string | null;
  tags: FinanceTagDto[];
};

export type FinanceGoalRecord = Record<BudgetCategoryKey, number>;

export type FinanceHistoryPointDto = {
  year: number;
  month: number;
  grossIncome: number;
  spent: number;
  balance: number;
};

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
    timeZone: string;
    objectives: string | null;
  };
  goals: FinanceGoalRecord;
  accounts: FinancialAccountDto[];
  transactions: FinanceTransactionDto[];
  recentTransactions: FinanceTransactionDto[];
  historyTransactions: FinanceTransactionDto[];
  history: FinanceHistoryPointDto[];
  tags: FinanceTagDto[];
  classificationRules: FinanceClassificationRuleDto[];
  unclassifiedTransactionCount: number;
  pendingFxTransactionCount: number;
  pendingDeletionCount: number;
  pluggy: {
    configured: boolean;
    itemCount: number;
    pendingCount: number;
    lastSyncAt: string | null;
  };
};
