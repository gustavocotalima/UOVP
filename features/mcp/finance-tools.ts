import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { BALANCE_META } from "@/features/balance-sheet/constants";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_META } from "@/features/budget/constants";
import {
  calculateInvoices,
  calculatePeriodAmounts,
  calculateTagTotals,
} from "@/features/finance/calculations";
import { calculateDailyExpenses } from "@/features/finance/daily-expenses";
import type { FinanceTransactionDto, FinancialAccountDto } from "@/features/finance/types";
import { resolvePluggyInstitutionName } from "@/features/open-finance/institution-logo";
import { readAnalysis } from "./query";
import { redactAnalysisText } from "./privacy";
import { McpError, type McpContext, type McpToolDefinition } from "./types";

const yearSchema = z.number().int().min(1900).max(9998);
const monthSchema = z.number().int().min(1).max(12);
const periodShape = { year: yearSchema, month: monthSchema };
const rangeShape = {
  fromYear: yearSchema,
  fromMonth: monthSchema,
  toYear: yearSchema,
  toMonth: monthSchema,
};
const pageShape = {
  pageSize: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(600).optional(),
};
const envelopeShape = {
  retrievedAt: z.iso.datetime(),
  timeZone: z.string(),
  data: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
};
const monetarySchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const periodTotalsSchema = z.object({
  currencyCode: z.literal("BRL"), grossIncome: monetarySchema, netIncome: monetarySchema,
  grossExpenses: monetarySchema, compensationApplied: monetarySchema,
  netExpenses: monetarySchema, netResult: monetarySchema,
});
const accountTotalsSchema = z.object({
  currencyCode: z.literal("BRL"), bankBalance: monetarySchema, cardDebt: monetarySchema,
  bankBalanceMinusCardDebt: monetarySchema, missingFxCount: z.number().int().nonnegative(),
});
const fxSchema = z.object({
  rateToBrl: monetarySchema.nullable(), date: z.string().nullable(),
  source: z.enum(["NATIVE", "PLUGGY", "YAHOO", "MANUAL"]).nullable(),
});
const accountResultSchema = z.object({
  id: z.string(), source: z.enum(["MANUAL", "PLUGGY"]), type: z.enum(["BANK_ACCOUNT", "CREDIT_CARD"]),
  name: z.string().nullable(), institutionName: z.string().nullable(), currencyCode: z.string(),
  balance: monetarySchema, balanceBrl: monetarySchema.nullable(),
  creditLimit: monetarySchema.nullable(), availableCredit: monetarySchema.nullable(),
  creditLimitBrl: monetarySchema.nullable(), availableCreditBrl: monetarySchema.nullable(),
  fx: fxSchema, providerUpdatedAt: z.iso.datetime().nullable(), updatedAt: z.iso.datetime(),
}).passthrough();
const transactionResultSchema = z.object({
  id: z.string(), accountId: z.string(), accountName: z.string().nullable(),
  source: z.enum(["MANUAL", "PLUGGY"]), kind: z.enum(["INCOME", "EXPENSE"]),
  description: z.string().nullable(), amount: monetarySchema, currencyCode: z.string(),
  reportingAmountBrl: monetarySchema.nullable(), fx: fxSchema, date: z.iso.datetime(),
  referenceYear: yearSchema, referenceMonth: monthSchema,
  ignored: z.boolean(), internalTransfer: z.boolean(), includedInReports: z.boolean(),
  tags: z.array(z.object({ id: z.string(), name: z.string().nullable(), color: z.string() })),
}).passthrough();

// Explicit projections keep credentials, account numbers, CPF/CNPJ and raw
// provider responses outside the MCP boundary.
const accountSelect = {
  id: true, source: true, type: true, subtype: true, name: true,
  institutionName: true, bankCode: true, balance: true, currencyCode: true,
  balanceBrl: true, balanceFxRateToBrl: true, balanceFxRateDate: true,
  balanceFxSource: true, creditLimit: true, availableCredit: true,
  dueDay: true, closingDay: true, providerUpdatedAt: true, updatedAt: true,
  investmentLink: { select: { enabled: true, status: true, assetHoldingId: true } },
} satisfies Prisma.FinancialAccountSelect;

const transactionSelect = {
  id: true, accountId: true, source: true, kind: true, description: true,
  amount: true, currencyCode: true, reportingAmountBrl: true,
  fxRateToBrl: true, fxRateDate: true, fxSource: true,
  originalAmount: true, originalCurrencyCode: true, date: true,
  referenceYear: true, referenceMonth: true, budgetCategory: true,
  budgetCategorySource: true, status: true, ignored: true,
  internalTransfer: true, providerLifecycle: true, installmentNumber: true,
  installmentTotal: true, createdAt: true, updatedAt: true,
  account: { select: { name: true, type: true } },
  tags: { select: { tag: { select: { id: true, systemKey: true, name: true, color: true } } } },
} satisfies Prisma.FinanceTransactionSelect;

type Account = Prisma.FinancialAccountGetPayload<{ select: typeof accountSelect }>;
type Transaction = Prisma.FinanceTransactionGetPayload<{ select: typeof transactionSelect }>;
type Period = { year: number; month: number };
type Range = { fromYear: number; fromMonth: number; toYear: number; toMonth: number };

function envelope(context: McpContext, data: Record<string, unknown>, warnings: string[] = []) {
  return { retrievedAt: new Date().toISOString(), timeZone: context.timeZone, data, warnings };
}

function tool<T extends z.ZodRawShape>(
  definition: Omit<McpToolDefinition, "inputSchema" | "outputSchema" | "execute"> & {
    inputSchema: T;
    dataSchema?: z.ZodType;
    execute: (context: McpContext, input: z.infer<z.ZodObject<T>>) => Promise<Record<string, unknown>>;
  },
): McpToolDefinition {
  const inputSchema = z.object(definition.inputSchema).strict();
  const { dataSchema, ...publicDefinition } = definition;
  return {
    ...publicDefinition,
    outputSchema: dataSchema ? { ...envelopeShape, data: dataSchema } : envelopeShape,
    execute: (context, input) => {
      if (!context.scopes.includes(definition.scope)) {
        throw new McpError("insufficient_scope", "This connection does not permit this analysis.", 403);
      }
      return definition.execute(context, inputSchema.parse(input));
    },
  };
}

function baseWhere(userId: string): Prisma.FinanceTransactionWhereInput {
  return { userId, deleted: false, account: { userId, active: true } };
}

function reportableWhere(userId: string): Prisma.FinanceTransactionWhereInput {
  return {
    ...baseWhere(userId), ignored: false, internalTransfer: false,
    OR: [{ providerLifecycle: null }, { providerLifecycle: { not: "REMOVED" } }],
  };
}

function monthWhere(period: Period) {
  return { referenceYear: period.year, referenceMonth: period.month };
}

function rangePeriods(range: Range) {
  const first = range.fromYear * 12 + range.fromMonth - 1;
  const last = range.toYear * 12 + range.toMonth - 1;
  if (last < first || last - first >= 12) {
    throw new McpError("invalid_period", "Choose an inclusive period of one to twelve financial reference months.");
  }
  return Array.from({ length: last - first + 1 }, (_, offset) => ({
    referenceYear: Math.floor((first + offset) / 12),
    referenceMonth: (first + offset) % 12 + 1,
  }));
}

function amount(value: Prisma.Decimal | null | undefined) {
  return value?.toFixed() ?? null;
}

function money(value: number) {
  if (!Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * 100))) {
    throw new McpError("precision_limit", "This total exceeds the supported financial calculation precision.");
  }
  return value.toFixed(2);
}

function calculationValue(value: Prisma.Decimal) {
  const numeric = value.toNumber();
  money(numeric);
  return numeric;
}

function periodTotals(totals: ReturnType<typeof calculatePeriodAmounts>) {
  return {
    currencyCode: "BRL",
    grossIncome: money(totals.grossIncome),
    netIncome: money(totals.budgetBaseIncome),
    grossExpenses: money(totals.grossExpenses),
    compensationApplied: money(totals.compensatedExpenses),
    netExpenses: money(totals.spent),
    netResult: money(totals.balance),
  };
}

async function groupedAmounts(db: Prisma.TransactionClient, where: Prisma.FinanceTransactionWhereInput) {
  const rows = await db.financeTransaction.groupBy({
    by: ["referenceYear", "referenceMonth", "kind", "budgetCategory"],
    where: { AND: [where, { reportingAmountBrl: { not: null } }] },
    _sum: { reportingAmountBrl: true }, _count: { _all: true },
  });
  return rows.map((row) => ({
    referenceYear: row.referenceYear, referenceMonth: row.referenceMonth,
    kind: row.kind, budgetCategory: row.budgetCategory,
    value: calculationValue(row._sum.reportingAmountBrl ?? new Prisma.Decimal(0)),
    count: row._count._all,
  }));
}

async function missingFx(db: Prisma.TransactionClient, where: Prisma.FinanceTransactionWhereInput) {
  return db.financeTransaction.count({ where: { AND: [where, { reportingAmountBrl: null }] } });
}

function fxWarnings(count: number) {
  return count ? [`${count} eligible transaction(s) lack BRL conversion and are excluded from monetary totals.`] : [];
}

function toTransactionDto(row: Transaction): FinanceTransactionDto {
  return {
    id: row.id, accountId: row.accountId, accountName: row.account.name,
    accountType: row.account.type, accountImageUrl: null, institutionName: null,
    source: row.source, kind: row.kind, description: row.description,
    descriptionRaw: null, merchantName: null, merchantBusinessName: null,
    merchantCnpj: null, merchantCategory: null, counterpartyName: null,
    paymentMethod: null, amount: row.amount.toFixed(), currencyCode: row.currencyCode,
    reportingAmountBrl: amount(row.reportingAmountBrl), fxRateToBrl: amount(row.fxRateToBrl),
    fxRateDate: row.fxRateDate?.toISOString() ?? null, fxSource: row.fxSource,
    originalAmount: amount(row.originalAmount), originalCurrencyCode: row.originalCurrencyCode,
    date: row.date.toISOString(), referenceYear: row.referenceYear, referenceMonth: row.referenceMonth,
    budgetCategory: row.budgetCategory, budgetCategorySource: row.budgetCategorySource,
    tagAssignmentSource: "UNASSIGNED", providerCategory: null, providerCategoryId: null,
    status: row.status, note: null, ignored: row.ignored, updateAccountBalance: false,
    providerLifecycle: row.providerLifecycle, providerDeletedAt: null,
    internalTransfer: row.internalTransfer, internalTransferSource: "UNASSIGNED",
    installmentNumber: row.installmentNumber, installmentTotal: row.installmentTotal,
    classificationRule: null, classifiedAt: null, tags: row.tags.map(({ tag }) => tag),
  };
}

function transactionResult(row: Transaction) {
  return {
    id: row.id, accountId: row.accountId, accountName: redactAnalysisText(row.account.name),
    accountType: row.account.type, source: row.source, kind: row.kind,
    description: redactAnalysisText(row.description), amount: row.amount.toFixed(), currencyCode: row.currencyCode,
    reportingAmountBrl: amount(row.reportingAmountBrl),
    fx: { rateToBrl: amount(row.fxRateToBrl), date: row.fxRateDate?.toISOString().slice(0, 10) ?? null, source: row.fxSource },
    originalAmount: amount(row.originalAmount), originalCurrencyCode: row.originalCurrencyCode,
    date: row.date.toISOString(), referenceYear: row.referenceYear, referenceMonth: row.referenceMonth,
    budgetCategory: row.budgetCategory, budgetCategorySource: row.budgetCategorySource,
    ignored: row.ignored, internalTransfer: row.internalTransfer,
    providerLifecycle: row.providerLifecycle, status: row.status,
    includedInReports: !row.ignored && !row.internalTransfer && row.providerLifecycle !== "REMOVED" && row.reportingAmountBrl !== null,
    installmentNumber: row.installmentNumber, installmentTotal: row.installmentTotal,
    tags: row.tags.map(({ tag }) => ({ id: tag.id, name: redactAnalysisText(tag.name), color: tag.color })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function accountDto(row: Account): FinancialAccountDto {
  return {
    id: row.id, source: row.source, type: row.type, subtype: row.subtype,
    name: row.name, institutionName: row.institutionName, institutionImageUrl: null,
    accountNumber: null, agency: null, numberLastFour: null, bankCode: null, brand: null,
    balance: row.balance.toFixed(), balanceBrl: amount(row.balanceBrl),
    balanceFxRateToBrl: amount(row.balanceFxRateToBrl),
    balanceFxRateDate: row.balanceFxRateDate?.toISOString() ?? null, balanceFxSource: row.balanceFxSource,
    balanceSnapshotAt: null, creditLimit: amount(row.creditLimit), availableCredit: amount(row.availableCredit),
    dueDay: row.dueDay, closingDay: row.closingDay, currencyCode: row.currencyCode,
    sortOrder: 0, providerUpdatedAt: row.providerUpdatedAt?.toISOString() ?? null, transactionCount: 0,
  };
}

function accountResult(row: Account) {
  const equivalent = (value: Prisma.Decimal | null) => {
    if (value === null) return null;
    if (row.currencyCode === "BRL") return value.toFixed(2);
    return row.balanceFxRateToBrl?.isPositive() ? value.mul(row.balanceFxRateToBrl).toFixed(2) : null;
  };
  return {
    id: row.id, source: row.source, type: row.type, subtype: row.subtype,
    name: redactAnalysisText(row.name),
    portfolioOverlap: row.investmentLink?.enabled ? {
      holdingId: row.investmentLink.assetHoldingId, status: row.investmentLink.status,
      sameMoneyAsAccountBalance: true,
      warning: "This account balance is also represented in the investment portfolio. Do not add it twice.",
    } : null,
    institutionName: redactAnalysisText(row.source === "PLUGGY"
      ? resolvePluggyInstitutionName(row.institutionName, null, [row.bankCode])
      : row.institutionName),
    currencyCode: row.currencyCode, balance: row.balance.toFixed(), balanceBrl: amount(row.balanceBrl),
    creditLimit: amount(row.creditLimit), availableCredit: amount(row.availableCredit),
    creditLimitBrl: equivalent(row.creditLimit), availableCreditBrl: equivalent(row.availableCredit),
    fx: { rateToBrl: amount(row.balanceFxRateToBrl), date: row.balanceFxRateDate?.toISOString().slice(0, 10) ?? null, source: row.balanceFxSource },
    dueDay: row.dueDay, closingDay: row.closingDay,
    providerUpdatedAt: row.providerUpdatedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(),
  };
}

function accountTotals(rows: Account[]) {
  let bankBalance = new Prisma.Decimal(0);
  let cardDebt = new Prisma.Decimal(0);
  for (const row of rows) {
    if (row.balanceBrl === null) continue;
    if (row.type === "BANK_ACCOUNT") bankBalance = bankBalance.add(row.balanceBrl);
    else cardDebt = cardDebt.add(row.balanceBrl.abs());
  }
  return {
    currencyCode: "BRL", bankBalance: bankBalance.toFixed(2), cardDebt: cardDebt.toFixed(2),
    bankBalanceMinusCardDebt: bankBalance.sub(cardDebt).toFixed(2),
    missingFxCount: rows.filter((row) => row.balanceBrl === null).length,
  };
}

const cursorSchema = z.object({
  v: z.literal(1), date: z.iso.datetime(), createdAt: z.iso.datetime(), id: z.string().min(1).max(200),
}).strict();

function transactionCursor(row: Transaction) {
  return Buffer.from(JSON.stringify({ v: 1, date: row.date.toISOString(), createdAt: row.createdAt.toISOString(), id: row.id })).toString("base64url");
}

function cursorWhere(cursor: string): Prisma.FinanceTransactionWhereInput {
  let parsed: z.infer<typeof cursorSchema>;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new McpError("invalid_cursor", "Invalid transaction cursor.");
  }
  const date = new Date(parsed.date);
  const createdAt = new Date(parsed.createdAt);
  return { OR: [
    { date: { lt: date } },
    { date, createdAt: { lt: createdAt } },
    { date, createdAt, id: { lt: parsed.id } },
  ] };
}

const summary = tool({
  name: "get_financial_summary", title: "Financial summary", scope: "finance:read",
  description: "BRL financial-reference-month summary. Net income excludes goal-assigned inflows; compensation is limited to the same goal and month. Current account totals require accounts:read and otherwise return null. Completeness covers only permitted data; balances are current, not historical.",
  inputSchema: periodShape,
  dataSchema: z.object({
    period: z.object(periodShape), totals: periodTotalsSchema,
    currentAccountTotals: accountTotalsSchema.nullable().describe("Null when accounts:read is not granted; no account balances were queried."),
    missingFxCount: z.number().int().nonnegative(), complete: z.boolean(),
  }),
  execute: async (context, input) => readAnalysis(context, async (db) => {
    const where = { AND: [reportableWhere(context.userId), monthWhere(input)] };
    const [groups, missing, accounts] = await Promise.all([
      groupedAmounts(db, where), missingFx(db, where),
      context.scopes.includes("accounts:read")
        ? db.financialAccount.findMany({ where: { userId: context.userId, active: true }, select: accountSelect })
        : Promise.resolve(null),
    ]);
    const balances = accounts === null ? null : accountTotals(accounts);
    return envelope(context, {
      period: input, totals: periodTotals(calculatePeriodAmounts(groups)), currentAccountTotals: balances,
      missingFxCount: missing, complete: missing === 0 && (balances === null || balances.missingFxCount === 0),
    }, [...fxWarnings(missing), ...(balances?.missingFxCount ? ["Some current account balances lack BRL conversion."] : []),
      ...(accounts?.some((account) => account.investmentLink?.enabled) ? ["Some account balances are also represented as ACCOUNT_BALANCE investments. Do not add both representations as separate wealth."] : []),
    ]);
  }),
});

const accounts = tool({
  name: "list_accounts", title: "Accounts and cards", scope: "accounts:read",
  description: "Active account/card balances in native currency and BRL. Does not return account/card numbers or fetch providers. Aggregate totals cover all filtered accounts, not just the page.",
  inputSchema: { ...pageShape, type: z.enum(["BANK_ACCOUNT", "CREDIT_CARD"]).optional() },
  dataSchema: z.object({
    accounts: z.array(accountResultSchema).max(100), totals: accountTotalsSchema,
    totalCount: z.number().int().nonnegative(), nextCursor: z.string().nullable(), complete: z.boolean(),
  }),
  execute: async (context, input) => readAnalysis(context, async (db) => {
    const where = { userId: context.userId, active: true, ...(input.type ? { type: input.type } : {}) };
    const rows = await db.financialAccount.findMany({ where, orderBy: { id: "asc" }, select: accountSelect });
    const index = input.cursor ? rows.findIndex((row) => row.id === input.cursor) : -1;
    if (input.cursor && index === -1) throw new McpError("invalid_cursor", "Invalid account cursor.");
    const page = rows.slice(index + 1, index + 1 + input.pageSize);
    const totals = accountTotals(rows);
    return envelope(context, {
      accounts: page.map(accountResult), totals, totalCount: rows.length,
      nextCursor: index + 1 + input.pageSize < rows.length ? page.at(-1)?.id ?? null : null,
      complete: totals.missingFxCount === 0,
    }, totals.missingFxCount ? ["Some account balances lack BRL conversion and are excluded from consolidated totals."] : []);
  }),
});

const transactionInput = {
  ...rangeShape, ...pageShape,
  accountId: z.string().min(1).max(200).optional(),
  kind: z.enum(["INCOME", "EXPENSE"]).optional(),
  budgetCategory: z.enum([...BUDGET_CATEGORIES, "NONE"]).optional(),
  tagId: z.string().min(1).max(200).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  ignored: z.boolean().optional(), internalTransfer: z.boolean().optional(),
};

const transactions = tool({
  name: "list_transactions", title: "Transactions", scope: "transactions:read",
  description: "Paginated full native/reporting transaction amounts for 1–12 financial reference months. Includes hidden/internal transactions for audit unless filtered; gross totals only include reportable rows and cover the entire filter.",
  inputSchema: transactionInput,
  dataSchema: z.object({
    referencePeriod: z.object(rangeShape), transactions: z.array(transactionResultSchema).max(100),
    totalCount: z.number().int().nonnegative(), nextCursor: z.string().nullable(),
    grossTotals: z.object({ currencyCode: z.literal("BRL"), income: monetarySchema, expenses: monetarySchema, balance: monetarySchema }),
    missingFxCount: z.number().int().nonnegative(), complete: z.boolean(),
  }),
  execute: async (context, input) => readAnalysis(context, async (db) => {
    const and: Prisma.FinanceTransactionWhereInput[] = [{ OR: rangePeriods(input) }];
    if (input.accountId) and.push({ accountId: input.accountId });
    if (input.kind) and.push({ kind: input.kind });
    if (input.budgetCategory) and.push({ budgetCategory: input.budgetCategory === "NONE" ? null : input.budgetCategory });
    if (input.tagId) and.push({ tags: { some: { tagId: input.tagId, tag: { userId: context.userId } } } });
    if (input.search) and.push({ description: { contains: input.search, mode: "insensitive" } });
    if (input.ignored !== undefined) and.push({ ignored: input.ignored });
    if (input.internalTransfer !== undefined) and.push({ internalTransfer: input.internalTransfer });
    const where = { ...baseWhere(context.userId), AND: and };
    const totalsWhere = { AND: [where, reportableWhere(context.userId)] };
    const [rows, totalCount, groups, missing] = await Promise.all([
      db.financeTransaction.findMany({
        where: input.cursor ? { AND: [where, cursorWhere(input.cursor)] } : where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: input.pageSize + 1, select: transactionSelect,
      }),
      db.financeTransaction.count({ where }), groupedAmounts(db, totalsWhere), missingFx(db, totalsWhere),
    ]);
    const totals = calculatePeriodAmounts(groups);
    const page = rows.slice(0, input.pageSize);
    return envelope(context, {
      referencePeriod: { fromYear: input.fromYear, fromMonth: input.fromMonth, toYear: input.toYear, toMonth: input.toMonth },
      transactions: page.map(transactionResult), totalCount,
      nextCursor: rows.length > input.pageSize && page.length ? transactionCursor(page[page.length - 1]) : null,
      grossTotals: { currencyCode: "BRL", income: money(totals.grossIncome), expenses: money(totals.grossExpenses), balance: money(totals.grossIncome - totals.grossExpenses) },
      missingFxCount: missing, complete: missing === 0,
    }, fxWarnings(missing));
  }),
});

const transaction = tool({
  name: "get_transaction", title: "Transaction detail", scope: "transactions:read",
  description: "One owned active-account transaction with its unchanged native amount, frozen historical FX, reporting amount, classification, and report eligibility.",
  inputSchema: { transactionId: z.string().min(1).max(200) },
  dataSchema: z.object({ transaction: transactionResultSchema }),
  execute: async (context, input) => readAnalysis(context, async (db) => {
    const row = await db.financeTransaction.findFirst({
      where: { ...baseWhere(context.userId), id: input.transactionId }, select: transactionSelect,
    });
    if (!row) throw new McpError("not_found", "Transaction not found.", 404);
    return envelope(context, { transaction: transactionResult(row) }, row.reportingAmountBrl === null ? ["BRL conversion is missing; this transaction is excluded from report totals."] : []);
  }),
});

const budget = tool({
  name: "get_budget_progress", title: "Budget goals", scope: "finance:read",
  description: "Monthly goal targets and net spending, using the same within-goal/month compensation as UOVP. Missing configuration is reported without creating defaults.",
  inputSchema: periodShape,
  execute: async (context, input) => readAnalysis(context, async (db) => {
    const where = { AND: [reportableWhere(context.userId), monthWhere(input)] };
    const [groups, goals, missing] = await Promise.all([
      groupedAmounts(db, where), db.financeGoal.findMany({ where: { userId: context.userId }, select: { category: true, percentage: true } }), missingFx(db, where),
    ]);
    const totals = calculatePeriodAmounts(groups);
    const configured = BUDGET_CATEGORIES.every((category) => goals.some((goal) => goal.category === category));
    const categories = BUDGET_CATEGORIES.map((category) => {
      const group = groups.filter((row) => row.budgetCategory === category);
      const categoryTotals = calculatePeriodAmounts(group);
      const percentage = goals.find((goal) => goal.category === category)?.percentage ?? null;
      const target = percentage === null ? null : new Prisma.Decimal(money(totals.budgetBaseIncome)).mul(percentage).div(100);
      const targetNumber = target?.toNumber() ?? null;
      return {
        category, label: BUDGET_CATEGORY_META[category].label,
        percentage: amount(percentage), target: target?.toFixed(2) ?? null,
        grossExpenses: money(categoryTotals.grossExpenses), goalIncome: money(categoryTotals.grossIncome),
        compensationApplied: money(categoryTotals.compensatedExpenses), netExpenses: money(categoryTotals.spent),
        remaining: targetNumber === null ? null : money(Math.max(0, targetNumber - categoryTotals.spent)),
        usagePercent: targetNumber === null ? null : targetNumber > 0 ? (categoryTotals.spent / targetNumber * 100).toFixed(2) : "0.00",
        exceeded: targetNumber === null ? null : categoryTotals.spent > targetNumber,
        transactionCount: group.reduce((count, row) => count + row.count, 0),
      };
    });
    return envelope(context, { period: input, configured, currencyCode: "BRL", netIncome: money(totals.budgetBaseIncome), categories, missingFxCount: missing, complete: missing === 0 }, [
      ...fxWarnings(missing), ...(!configured ? ["Budget goals are not fully configured; absent targets remain unknown."] : []),
    ]);
  }),
});

const history = tool({
  name: "get_financial_history", title: "Financial history", scope: "finance:read",
  description: "Monthly gross and net amounts across 1–12 financial reference months. Compensation never crosses goals or months.",
  inputSchema: rangeShape,
  dataSchema: z.object({
    months: z.array(periodTotalsSchema.extend(periodShape)).min(1).max(12),
    missingFxCount: z.number().int().nonnegative(), complete: z.boolean(),
  }),
  execute: async (context, input) => readAnalysis(context, async (db) => {
    const periods = rangePeriods(input);
    const where = { AND: [reportableWhere(context.userId), { OR: periods }] };
    const [groups, missing] = await Promise.all([groupedAmounts(db, where), missingFx(db, where)]);
    return envelope(context, {
      months: periods.map((period) => ({ year: period.referenceYear, month: period.referenceMonth,
        ...periodTotals(calculatePeriodAmounts(groups.filter((row) => row.referenceYear === period.referenceYear && row.referenceMonth === period.referenceMonth))),
      })), missingFxCount: missing, complete: missing === 0,
    }, fxWarnings(missing));
  }),
});

const tags = tool({
  name: "get_tag_cashflow", title: "Cashflow by tag", scope: "finance:read",
  description: "Actual gross inflows and outflows by tag. Multi-tag values split equally in integer cents with deterministic remainders; no goal-based compensation is attributed to tags.",
  inputSchema: { ...periodShape, ...pageShape },
  execute: async (context, input) => readAnalysis(context, async (db) => {
    const where = { AND: [reportableWhere(context.userId), monthWhere(input)] };
    const [rows, configuredTags, missing] = await Promise.all([
      db.financeTransaction.findMany({ where, select: transactionSelect }),
      db.financeTag.findMany({ where: { userId: context.userId }, select: { id: true, systemKey: true, name: true, color: true }, orderBy: { id: "asc" } }),
      missingFx(db, where),
    ]);
    const totals = calculateTagTotals(rows.map(toTransactionDto), configuredTags);
    const index = input.cursor ? totals.findIndex((tag) => tag.id === input.cursor) : -1;
    if (input.cursor && index === -1) throw new McpError("invalid_cursor", "Invalid tag cursor.");
    const page = totals.slice(index + 1, index + 1 + input.pageSize);
    return envelope(context, {
      period: { year: input.year, month: input.month }, currencyCode: "BRL",
      tags: page.map((tag) => ({ id: tag.id, name: redactAnalysisText(tag.name), color: tag.color, income: money(tag.income), expenses: money(tag.value) })),
      totalCount: totals.length, nextCursor: index + 1 + input.pageSize < totals.length ? page.at(-1)?.id ?? null : null,
      grossIncome: money(totals.reduce((sum, tag) => sum + tag.income, 0)),
      grossExpenses: money(totals.reduce((sum, tag) => sum + tag.value, 0)),
      missingFxCount: missing, complete: missing === 0,
    }, fxWarnings(missing));
  }),
});

const daily = tool({
  name: "get_daily_expenses", title: "Daily gross expenses", scope: "finance:read",
  description: "Full gross reporting outflows per calendar day within a financial reference month, never reduced by reinvestment compensation. Reference-month transactions dated outside the calendar month are reported separately.",
  inputSchema: periodShape,
  execute: async (context, input) => readAnalysis(context, async (db) => {
    const where = { AND: [reportableWhere(context.userId), monthWhere(input)] };
    const [rows, missing] = await Promise.all([db.financeTransaction.findMany({ where, select: transactionSelect }), missingFx(db, where)]);
    const result = calculateDailyExpenses(rows.map(toTransactionDto), input.year, input.month, context.timeZone);
    return envelope(context, {
      period: input, currencyCode: "BRL", total: money(result.totalCents / 100),
      inCalendarTotal: money(result.inCalendarCents / 100), outsideCalendarTotal: money(result.outsideCents / 100),
      outsideCalendarTransactionCount: result.outsideEntries.length,
      days: result.days.map((day) => ({ date: day.date, expenses: money(day.totalCents / 100), transactionCount: day.entries.length })),
      daysWithExpenses: result.daysWithExpenses, daysWithoutExpenses: result.daysWithoutExpenses,
      averagePerCalendarDay: money(result.averageCents / 100),
      largestDay: result.peakDay ? { date: result.peakDay.date, expenses: money(result.peakDay.totalCents / 100) } : null,
      missingFxCount: missing, complete: missing === 0,
    }, fxWarnings(missing));
  }),
});

const invoices = tool({
  name: "get_card_invoices", title: "Estimated card invoices", scope: "accounts:read",
  description: "Invoices inferred from card transaction dates and closing/due days, not confirmed bank invoice statements. Native and BRL totals retain full amounts; transaction detail requires transactions:read separately.",
  inputSchema: { ...rangeShape, ...pageShape, accountId: z.string().min(1).max(200) },
  execute: async (context, input) => readAnalysis(context, async (db) => {
    const periods = rangePeriods(input);
    const account = await db.financialAccount.findFirst({
      where: { id: input.accountId, userId: context.userId, active: true, type: "CREDIT_CARD" }, select: accountSelect,
    });
    if (!account) throw new McpError("not_found", "Credit card not found.", 404);
    const rows = await db.financeTransaction.findMany({
      where: { ...baseWhere(context.userId), accountId: account.id, OR: periods }, select: transactionSelect,
    });
    const result = calculateInvoices(accountDto(account), rows.map(toTransactionDto), new Date(), context.timeZone);
    const index = input.cursor ? result.findIndex((invoice) => invoice.key === input.cursor) : -1;
    if (input.cursor && index === -1) throw new McpError("invalid_cursor", "Invalid invoice cursor.");
    const page = result.slice(index + 1, index + 1 + input.pageSize);
    const missing = rows.filter((row) => !row.ignored && !row.internalTransfer && row.providerLifecycle !== "REMOVED" && row.amount.isNegative() && row.reportingAmountBrl === null).length;
    return envelope(context, {
      account: accountResult(account), estimated: true,
      coverage: { fromYear: input.fromYear, fromMonth: input.fromMonth, toYear: input.toYear, toMonth: input.toMonth, basis: "FINANCIAL_REFERENCE_MONTH" },
      invoices: page.map((invoice) => ({ key: invoice.key, year: invoice.year, month: invoice.month, dueDate: invoice.dueDate.slice(0, 10), open: invoice.open,
        currencyCode: account.currencyCode, total: money(invoice.total), totalBrl: money(invoice.totalBrl),
        transactionCount: invoice.transactions.length,
        missingFxCount: invoice.transactions.filter((row) => !row.ignored && !row.internalTransfer && row.providerLifecycle !== "REMOVED" && Number(row.amount) < 0 && row.reportingAmountBrl === null).length,
      })), totalCount: result.length, nextCursor: index + 1 + input.pageSize < result.length ? page.at(-1)?.key ?? null : null,
      missingFxCount: missing, complete: missing === 0,
    }, ["Invoice amounts are estimates based only on available transactions and configured closing/due dates; they are not bank-confirmed bills.", ...fxWarnings(missing)]);
  }),
});

const balanceSheet = tool({
  name: "get_balance_sheet", title: "Separate balance sheet", scope: "balance-sheet:read",
  description: "User-maintained BRL balance-sheet assets/liabilities. These are separate entries and must not be added to wallet/account totals automatically, because they may overlap.",
  inputSchema: pageShape,
  execute: async (context, input) => readAnalysis(context, async (db) => {
    const rows = await db.balanceSheetEntry.findMany({
      where: { userId: context.userId }, orderBy: { id: "asc" }, select: { id: true, category: true, name: true, value: true, updatedAt: true },
    });
    let assetTotal = new Prisma.Decimal(0);
    let liabilityTotal = new Prisma.Decimal(0);
    for (const row of rows) {
      if (BALANCE_META[row.category].side === "asset") assetTotal = assetTotal.add(row.value);
      else liabilityTotal = liabilityTotal.add(row.value);
    }
    const index = input.cursor ? rows.findIndex((row) => row.id === input.cursor) : -1;
    if (input.cursor && index === -1) throw new McpError("invalid_cursor", "Invalid balance-sheet cursor.");
    const page = rows.slice(index + 1, index + 1 + input.pageSize);
    return envelope(context, {
      currencyCode: "BRL", separateFromPortfolio: true,
      entries: page.map((row) => ({ id: row.id, category: row.category, side: BALANCE_META[row.category].side, name: redactAnalysisText(row.name), value: row.value.toFixed(), updatedAt: row.updatedAt.toISOString() })),
      totals: { assets: assetTotal.toFixed(2), liabilities: liabilityTotal.toFixed(2), netWorth: assetTotal.sub(liabilityTotal).toFixed(2) },
      totalCount: rows.length, nextCursor: index + 1 + input.pageSize < rows.length ? page.at(-1)?.id ?? null : null,
    }, ["Balance-sheet entries are maintained separately and may overlap with accounts or investments; do not double-count them."]);
  }),
});

export const financeTools: McpToolDefinition[] = [summary, accounts, transactions, transaction, budget, history, tags, daily, invoices, balanceSheet];
