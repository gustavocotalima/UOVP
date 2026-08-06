"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type BudgetCategory, type FinancialAccountType } from "@prisma/client";
import { z } from "zod";
import { BUDGET_CATEGORIES, type BudgetCategoryKey } from "@/features/budget/constants";
import { requireUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  classifyFinanceTransactionsForUser,
  learnFinanceClassificationRule,
} from "./classification-service";
import { normalizeFinanceRuleValue } from "./classification";
import { ensureFinanceSetup } from "./data";
import {
  financialFxRequired,
  resolveCurrentFinancialFx,
  resolveHistoricalFinancialFx,
  type FinancialMutationResult,
} from "./account-fx";
import {
  SUPPORTED_FINANCIAL_ACCOUNT_CURRENCIES,
  accountBalanceBrl,
  availableCreditForBalance,
  type FinancialAccountCurrency,
} from "./account-currency";
import {
  absorbManualTransactionsIntoBalance,
  accountBalanceDelta,
  balanceTransitionAdjustments,
} from "./manual-account-balance";

const idSchema = z.string().min(1).max(200);
const categorySchema = z.enum(BUDGET_CATEGORIES);
const accountTypeSchema = z.enum(["BANK_ACCOUNT", "CREDIT_CARD"]);
const accountCurrencySchema = z.enum(SUPPORTED_FINANCIAL_ACCOUNT_CURRENCIES);
const moneySchema = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const fxRateSchema = z.number().finite().positive().max(1_000_000);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const SERIALIZABLE_RETRY_LIMIT = 3;

async function withSerializableRetry<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2034";
      if (!retryable || attempt === SERIALIZABLE_RETRY_LIMIT - 1) throw error;
    }
  }
  throw new Error("Não foi possível concluir a operação concorrente.");
}

async function lockOwnedActiveAccounts(
  tx: Prisma.TransactionClient,
  userId: string,
  accountIds: string[],
) {
  const ids = [...new Set(accountIds)].sort();
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "FinancialAccount"
    WHERE "userId" = ${userId}
      AND "active" = true
      AND "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `);
  if (locked.length !== ids.length) throw new Error("Uma ou mais contas não foram encontradas.");
}

function revalidateFinance() {
  [
    "/home",
    "/orcamento-domestico",
    "/metas",
    "/contas",
    "/faturas",
    "/transacoes",
    "/tags",
    "/perfil",
    "/open-finance",
  ].forEach((path) => revalidatePath(path));
}

async function ownedTransaction(userId: string, id: string) {
  const transaction = await prisma.financeTransaction.findFirst({ where: { id, userId, deleted: false } });
  if (!transaction) throw new Error("Transação não encontrada.");
  return transaction;
}

async function ownedAccount(userId: string, id: string) {
  const account = await prisma.financialAccount.findFirst({ where: { id, userId, active: true } });
  if (!account) throw new Error("Conta não encontrada.");
  return account;
}

export async function saveFinanceProfileAction(input: {
  name: string;
  monthlyIncome: number;
  financialMonthStart: number;
  objectives?: string;
}) {
  const userId = await requireUserId();
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(120),
      monthlyIncome: z.number().finite().min(0).max(1_000_000_000),
      financialMonthStart: z.number().int().min(1).max(28),
      objectives: z.string().trim().max(4_000).optional(),
    })
    .parse(input);
  await ensureFinanceSetup(userId);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { name: parsed.name } }),
    prisma.financeProfile.update({
      where: { userId },
      data: {
        monthlyIncome: parsed.monthlyIncome,
        financialMonthStart: parsed.financialMonthStart,
        objectives: parsed.objectives || null,
      },
    }),
    prisma.$executeRaw`
      UPDATE "FinanceTransaction"
      SET
        "referenceYear" = EXTRACT(
          YEAR FROM CASE
            WHEN EXTRACT(DAY FROM "date") < ${parsed.financialMonthStart}
            THEN "date" - INTERVAL '1 month'
            ELSE "date"
          END
        )::INTEGER,
        "referenceMonth" = EXTRACT(
          MONTH FROM CASE
            WHEN EXTRACT(DAY FROM "date") < ${parsed.financialMonthStart}
            THEN "date" - INTERVAL '1 month'
            ELSE "date"
          END
        )::INTEGER,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = ${userId}
        AND "referenceOverridden" = false
    `,
  ]);
  revalidateFinance();
}

export async function saveFinanceGoalsAction(goals: Record<BudgetCategoryKey, number>) {
  const userId = await requireUserId();
  const parsed = z.record(categorySchema, z.number().finite().min(0).max(100)).parse(goals);
  const total = BUDGET_CATEGORIES.reduce((sum, category) => sum + (parsed[category] ?? 0), 0);
  if (Math.abs(total - 100) > 0.001) throw new Error("As metas precisam totalizar 100%.");
  await ensureFinanceSetup(userId);
  await prisma.$transaction(
    BUDGET_CATEGORIES.map((category) =>
      prisma.financeGoal.upsert({
        where: { userId_category: { userId, category: category as BudgetCategory } },
        update: { percentage: parsed[category] ?? 0 },
        create: { userId, category: category as BudgetCategory, percentage: parsed[category] ?? 0 },
      }),
    ),
  );
  revalidateFinance();
}

export async function resetFinanceGoalsAction() {
  return saveFinanceGoalsAction({
    FIXED_COSTS: 30,
    COMFORT: 15,
    GOALS: 15,
    PLEASURES: 10,
    FINANCIAL_FREEDOM: 25,
    KNOWLEDGE: 5,
  });
}

export async function createFinanceTagAction(input: { name: string; color: string }) {
  const userId = await requireUserId();
  const parsed = z.object({ name: z.string().trim().min(1).max(48), color: colorSchema }).parse(input);
  await prisma.financeTag.create({ data: { userId, ...parsed } });
  revalidateFinance();
}

export async function updateFinanceTagAction(input: { id: string; name: string; color: string }) {
  const userId = await requireUserId();
  const parsed = z
    .object({ id: idSchema, name: z.string().trim().min(1).max(48), color: colorSchema })
    .parse(input);
  const result = await prisma.financeTag.updateMany({
    where: { id: parsed.id, userId },
    data: { name: parsed.name, color: parsed.color },
  });
  if (!result.count) throw new Error("Tag não encontrada.");
  revalidateFinance();
}

export async function deleteFinanceTagAction(id: string) {
  const userId = await requireUserId();
  const parsedId = idSchema.parse(id);
  const tag = await prisma.financeTag.findFirst({ where: { id: parsedId, userId } });
  if (tag?.systemKey) throw new Error("Tags padrão podem ser editadas, mas não excluídas.");
  const result = await prisma.financeTag.deleteMany({ where: { id: parsedId, userId } });
  if (!result.count) throw new Error("Tag não encontrada.");
  revalidateFinance();
}

export async function saveFinancialAccountAction(input: {
  id?: string;
  type: "BANK_ACCOUNT" | "CREDIT_CARD";
  subtype?: string;
  name: string;
  institutionName?: string;
  accountNumber?: string;
  agency?: string;
  numberLastFour?: string;
  bankCode?: string;
  brand?: string;
  balance: number;
  expectedBalance?: number;
  currencyCode: FinancialAccountCurrency;
  manualFxRateToBrl?: number;
  creditLimit?: number | null;
  dueDay?: number | null;
  closingDay?: number | null;
}) {
  const userId = await requireUserId();
  const parsed = z
    .object({
      id: idSchema.optional(),
      type: accountTypeSchema,
      subtype: z.string().trim().max(48).optional(),
      name: z.string().trim().min(2).max(120),
      institutionName: z.string().trim().max(120).optional(),
      accountNumber: z.string().trim().max(64).optional(),
      agency: z.string().trim().max(32).optional(),
      numberLastFour: z.string().trim().max(4).optional(),
      bankCode: z.string().trim().max(12).optional(),
      brand: z.string().trim().max(32).optional(),
      balance: moneySchema,
      expectedBalance: moneySchema.optional(),
      currencyCode: accountCurrencySchema,
      manualFxRateToBrl: fxRateSchema.optional(),
      creditLimit: z.number().finite().min(0).max(1_000_000_000).nullable().optional(),
      dueDay: z.number().int().min(1).max(31).nullable().optional(),
      closingDay: z.number().int().min(1).max(31).nullable().optional(),
    })
    .parse(input);
  const existingAccount = parsed.id ? await ownedAccount(userId, parsed.id) : null;
  if (existingAccount?.source === "PLUGGY") {
    await prisma.financialAccount.update({
      where: { id: existingAccount.id },
      data: { name: parsed.name },
    });
    revalidateFinance();
    return { ok: true } satisfies FinancialMutationResult;
  }
  const fx = await resolveCurrentFinancialFx({
    currencyCode: parsed.currencyCode,
    manualRateToBrl: parsed.manualFxRateToBrl,
    existing: existingAccount
      ? {
          rateToBrl: existingAccount.balanceFxRateToBrl,
          rateDate: existingAccount.balanceFxRateDate,
          source: existingAccount.balanceFxSource,
          fetchedAt: existingAccount.providerUpdatedAt,
        }
      : null,
  });
  if (!fx && parsed.currencyCode === "USD" && parsed.balance !== 0) {
    return financialFxRequired(new Date());
  }
  const balance = new Prisma.Decimal(parsed.balance);
  const creditLimit = parsed.creditLimit == null ? null : new Prisma.Decimal(parsed.creditLimit);
  const data = {
    type: parsed.type as FinancialAccountType,
    subtype: parsed.subtype || null,
    name: parsed.name,
    institutionName: parsed.institutionName || null,
    accountNumber: parsed.accountNumber || null,
    agency: parsed.agency || null,
    numberLastFour: parsed.numberLastFour || null,
    bankCode: parsed.bankCode || null,
    brand: parsed.brand || null,
    balance,
    currencyCode: parsed.currencyCode,
    balanceBrl: fx ? accountBalanceBrl(balance, fx.rateToBrl).toString() : new Prisma.Decimal(0),
    balanceFxRateToBrl: fx?.rateToBrl ?? null,
    balanceFxRateDate: fx?.rateDate ?? null,
    balanceFxSource: fx?.source ?? null,
    providerUpdatedAt: parsed.currencyCode === "USD" ? fx?.fetchedAt ?? null : null,
    creditLimit,
    availableCredit: availableCreditForBalance(parsed.type, creditLimit, balance)?.toString() ?? null,
    dueDay: parsed.dueDay ?? null,
    closingDay: parsed.closingDay ?? null,
  };
  if (existingAccount) {
    const expectedBalance = parsed.expectedBalance;
    if (expectedBalance === undefined) {
      throw new Error("O saldo atual da conta precisa ser confirmado antes de salvar.");
    }
    await withSerializableRetry(async (tx) => {
      await lockOwnedActiveAccounts(tx, userId, [existingAccount.id]);
      const lockedAccount = await tx.financialAccount.findFirstOrThrow({
        where: { id: existingAccount.id, userId, active: true },
      });
      if (lockedAccount.source !== "MANUAL") {
        throw new Error("A conta passou a ser controlada pela instituição. Atualize a página.");
      }
      if (!lockedAccount.balance.equals(new Prisma.Decimal(expectedBalance))) {
        throw new Error("O saldo da conta mudou enquanto você editava. Atualize a página e tente novamente.");
      }
      if (lockedAccount.currencyCode !== parsed.currencyCode) {
        const transactionCount = await tx.financeTransaction.count({
          where: { accountId: lockedAccount.id },
        });
        if (transactionCount > 0) {
          throw new Error("A moeda não pode ser alterada depois que a conta possui transações.");
        }
      }
      const balanceChanged = !lockedAccount.balance.equals(balance);
      await tx.financialAccount.update({
        where: { id: lockedAccount.id },
        data: {
          ...data,
          ...(balanceChanged ? { balanceSnapshotAt: new Date() } : {}),
        },
      });
      if (balanceChanged) {
        await absorbManualTransactionsIntoBalance(tx, userId, lockedAccount.id);
      }
    });
  } else {
    const max = await prisma.financialAccount.aggregate({
      where: { userId, type: parsed.type as FinancialAccountType },
      _max: { sortOrder: true },
    });
    await prisma.financialAccount.create({
      data: {
        userId,
        source: "MANUAL",
        balanceSnapshotAt: new Date(),
        sortOrder: (max._max.sortOrder ?? -1) + 1,
        ...data,
      },
    });
  }
  revalidateFinance();
  return { ok: true } satisfies FinancialMutationResult;
}

export async function deleteFinancialAccountAction(id: string) {
  const userId = await requireUserId();
  const account = await ownedAccount(userId, idSchema.parse(id));
  if (account.source === "MANUAL") {
    await prisma.financialAccount.delete({ where: { id: account.id } });
  } else {
    await prisma.financialAccount.update({ where: { id: account.id }, data: { active: false } });
  }
  revalidateFinance();
}

export async function reorderFinancialAccountsAction(
  type: "BANK_ACCOUNT" | "CREDIT_CARD",
  accountIds: string[],
) {
  const userId = await requireUserId();
  const parsedType = accountTypeSchema.parse(type);
  const ids = z.array(idSchema).min(1).max(100).parse(accountIds);
  if (new Set(ids).size !== ids.length) throw new Error("A ordem contém contas duplicadas.");
  const count = await prisma.financialAccount.count({
    where: { userId, type: parsedType as FinancialAccountType, id: { in: ids }, active: true },
  });
  if (count !== ids.length) throw new Error("Uma ou mais contas não pertencem a este usuário.");
  await prisma.$transaction(
    ids.map((id, sortOrder) => prisma.financialAccount.update({ where: { id }, data: { sortOrder } })),
  );
  revalidateFinance();
}

async function adjustManualAccountBalance(
  tx: Prisma.TransactionClient,
  accountId: string,
  adjustment: Prisma.Decimal,
) {
  const account = await tx.financialAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (account.source !== "MANUAL") return;
  const updated = await tx.financialAccount.update({
    where: { id: account.id },
    data: { balance: { increment: adjustment } },
  });
  const balanceBrl = updated.currencyCode === "BRL"
    ? updated.balance
    : updated.balanceFxRateToBrl
      ? accountBalanceBrl(updated.balance, updated.balanceFxRateToBrl).toString()
      : null;
  await tx.financialAccount.update({
    where: { id: account.id },
    data: {
      balanceBrl,
      availableCredit: availableCreditForBalance(
        updated.type,
        updated.creditLimit,
        updated.balance,
      )?.toString() ?? null,
    },
  });
}

export async function createFinanceTransactionAction(input: {
  kind: "INCOME" | "EXPENSE";
  description: string;
  accountId: string;
  amount: number;
  date: string;
  referenceYear: number;
  referenceMonth: number;
  budgetCategory?: BudgetCategoryKey | null;
  tagIds?: string[];
  note?: string;
  manualFxRateToBrl?: number;
  updateAccountBalance?: boolean;
}) {
  const userId = await requireUserId();
  const parsed = z
    .object({
      kind: z.enum(["INCOME", "EXPENSE"]),
      description: z.string().trim().min(2).max(180),
      accountId: idSchema,
      amount: z.number().finite().positive().max(1_000_000_000),
      date: z.string().date(),
      referenceYear: z.number().int().min(2000).max(2200),
      referenceMonth: z.number().int().min(1).max(12),
      budgetCategory: categorySchema.nullable().optional(),
      tagIds: z.array(idSchema).max(20).optional(),
      note: z.string().trim().max(2_000).optional(),
      manualFxRateToBrl: fxRateSchema.optional(),
      updateAccountBalance: z.boolean().default(true),
    })
    .parse(input);
  const account = await ownedAccount(userId, parsed.accountId);
  const tagIds = [...new Set(parsed.tagIds ?? [])];
  if (tagIds.length) {
    const ownedTags = await prisma.financeTag.count({ where: { userId, id: { in: tagIds } } });
    if (ownedTags !== tagIds.length) throw new Error("Uma ou mais tags são inválidas.");
  }
  const signedAmount = new Prisma.Decimal(parsed.amount).times(parsed.kind === "EXPENSE" ? -1 : 1);
  const currencyCode = accountCurrencySchema.parse(account.currencyCode);
  const transactionDate = new Date(`${parsed.date}T12:00:00.000Z`);
  const fx = await resolveHistoricalFinancialFx({
    currencyCode,
    transactionDate,
    manualRateToBrl: parsed.manualFxRateToBrl,
  });
  if (!fx) return financialFxRequired(transactionDate);
  await withSerializableRetry(async (tx) => {
    await lockOwnedActiveAccounts(tx, userId, [account.id]);
    const lockedAccount = await tx.financialAccount.findFirstOrThrow({
      where: { id: account.id, userId, active: true },
    });
    if (lockedAccount.currencyCode !== currencyCode) {
      throw new Error("A moeda da conta mudou. Atualize a página e tente novamente.");
    }
    const balanceApplied = lockedAccount.source === "MANUAL" && parsed.updateAccountBalance;
    await tx.financeTransaction.create({
      data: {
        userId,
        accountId: account.id,
        source: "MANUAL",
        kind: parsed.kind,
        description: parsed.description,
        amount: signedAmount,
        currencyCode,
        reportingAmountBrl: signedAmount.mul(fx.rateToBrl).toDecimalPlaces(2),
        fxRateToBrl: fx.rateToBrl,
        fxRateDate: fx.rateDate,
        fxSource: fx.source,
        date: transactionDate,
        referenceYear: parsed.referenceYear,
        referenceMonth: parsed.referenceMonth,
        referenceOverridden: true,
        budgetCategory: parsed.budgetCategory ?? null,
        budgetCategorySource: "MANUAL",
        tagAssignmentSource: "MANUAL",
        balanceApplied,
        note: parsed.note || null,
        tags: { create: tagIds.map((tagId) => ({ tagId, source: "MANUAL" })) },
      },
    });
    if (balanceApplied) {
      await adjustManualAccountBalance(
        tx,
        lockedAccount.id,
        accountBalanceDelta(lockedAccount.type, signedAmount),
      );
    }
  });
  revalidateFinance();
  return { ok: true } satisfies FinancialMutationResult;
}

export async function updateFinanceTransactionAction(input: {
  id: string;
  description?: string;
  accountId?: string;
  amount?: number;
  kind?: "INCOME" | "EXPENSE";
  date?: string;
  referenceYear: number;
  referenceMonth: number;
  budgetCategory?: BudgetCategoryKey | null;
  tagIds: string[];
  note?: string;
  manualFxRateToBrl?: number;
  updateAccountBalance?: boolean;
}) {
  const userId = await requireUserId();
  const parsed = z
    .object({
      id: idSchema,
      description: z.string().trim().min(2).max(180).optional(),
      accountId: idSchema.optional(),
      amount: z.number().finite().positive().max(1_000_000_000).optional(),
      kind: z.enum(["INCOME", "EXPENSE"]).optional(),
      date: z.string().date().optional(),
      referenceYear: z.number().int().min(2000).max(2200),
      referenceMonth: z.number().int().min(1).max(12),
      budgetCategory: categorySchema.nullable().optional(),
      tagIds: z.array(idSchema).max(20),
      note: z.string().trim().max(2_000).optional(),
      manualFxRateToBrl: fxRateSchema.optional(),
      updateAccountBalance: z.boolean().optional(),
    })
    .parse(input);
  const transaction = await ownedTransaction(userId, parsed.id);
  const uniqueTags = [...new Set(parsed.tagIds)];
  if (uniqueTags.length) {
    const ownedTags = await prisma.financeTag.count({ where: { userId, id: { in: uniqueTags } } });
    if (ownedTags !== uniqueTags.length) throw new Error("Uma ou mais tags são inválidas.");
  }
  if (transaction.source === "PLUGGY" && (parsed.description || parsed.accountId || parsed.amount || parsed.date)) {
    throw new Error("Descrição, conta, valor e data são mantidos pela instituição.");
  }
  const targetAccount = parsed.accountId ? await ownedAccount(userId, parsed.accountId) : null;
  const currentAccount = await ownedAccount(userId, transaction.accountId);
  const kind = parsed.kind ?? transaction.kind;
  const amount = parsed.amount !== undefined
    ? new Prisma.Decimal(parsed.amount).times(kind === "EXPENSE" ? -1 : 1)
    : parsed.kind && parsed.kind !== transaction.kind
      ? transaction.amount.abs().times(kind === "EXPENSE" ? -1 : 1)
      : transaction.amount;
  const nextAccount = targetAccount ?? currentAccount;
  const transactionDate = parsed.date
    ? new Date(`${parsed.date}T12:00:00.000Z`)
    : transaction.date;
  const currencyCode = transaction.source === "MANUAL"
    ? accountCurrencySchema.parse(nextAccount.currencyCode)
    : accountCurrencySchema.safeParse(transaction.currencyCode).success
      ? transaction.currencyCode as FinancialAccountCurrency
      : "BRL";
  const fx = transaction.source === "MANUAL"
    ? await resolveHistoricalFinancialFx({
        currencyCode,
        transactionDate,
        manualRateToBrl: parsed.manualFxRateToBrl,
        existing: {
          currencyCode: transaction.currencyCode,
          rateToBrl: transaction.fxRateToBrl,
          rateDate: transaction.fxRateDate,
          source: transaction.fxSource,
        },
      })
    : null;
  if (transaction.source === "MANUAL" && !fx) return financialFxRequired(transactionDate);
  await withSerializableRetry(async (tx) => {
    await lockOwnedActiveAccounts(tx, userId, [currentAccount.id, nextAccount.id]);
    const currentTransaction = await tx.financeTransaction.findFirstOrThrow({
      where: { id: transaction.id, userId, deleted: false },
    });
    if (currentTransaction.accountId !== currentAccount.id) {
      throw new Error("A transação mudou enquanto você editava. Atualize a página e tente novamente.");
    }
    const lockedCurrentAccount = await tx.financialAccount.findFirstOrThrow({
      where: { id: currentAccount.id, userId, active: true },
    });
    const lockedNextAccount = nextAccount.id === currentAccount.id
      ? lockedCurrentAccount
      : await tx.financialAccount.findFirstOrThrow({
          where: { id: nextAccount.id, userId, active: true },
        });
    const balanceApplied = currentTransaction.source === "MANUAL"
      && lockedNextAccount.source === "MANUAL"
      && (parsed.updateAccountBalance ?? currentTransaction.balanceApplied);
    const adjustments = balanceTransitionAdjustments({
      previous: currentTransaction.source === "MANUAL"
        ? {
            type: lockedCurrentAccount.type,
            amount: currentTransaction.amount,
            applied: currentTransaction.balanceApplied,
          }
        : undefined,
      next: currentTransaction.source === "MANUAL"
        ? {
            type: lockedNextAccount.type,
            amount,
            applied: balanceApplied,
          }
        : undefined,
    });
    if (adjustments.reversePrevious) {
      await adjustManualAccountBalance(
        tx,
        lockedCurrentAccount.id,
        adjustments.reversePrevious,
      );
    }
    if (adjustments.applyNext) {
      await adjustManualAccountBalance(
        tx,
        lockedNextAccount.id,
        adjustments.applyNext,
      );
    }
    await tx.financeTransaction.update({
      where: { id: transaction.id },
      data: {
        ...(transaction.source === "MANUAL"
          ? {
              description: parsed.description ?? transaction.description,
              accountId: targetAccount?.id ?? transaction.accountId,
              amount,
              currencyCode,
              reportingAmountBrl: amount.mul(fx!.rateToBrl).toDecimalPlaces(2),
              fxRateToBrl: fx!.rateToBrl,
              fxRateDate: fx!.rateDate,
              fxSource: fx!.source,
              kind,
              date: transactionDate,
              balanceApplied,
            }
          : {}),
        referenceYear: parsed.referenceYear,
        referenceMonth: parsed.referenceMonth,
        referenceOverridden: true,
        budgetCategory: parsed.budgetCategory ?? null,
        budgetCategorySource: "MANUAL",
        tagAssignmentSource: "MANUAL",
        note: parsed.note || null,
        tags: {
          deleteMany: {},
          create: uniqueTags.map((tagId) => ({ tagId, source: "MANUAL" })),
        },
      },
    });
  });
  revalidateFinance();
  return { ok: true } satisfies FinancialMutationResult;
}

export async function updateFinanceTransactionCategoryAction(
  id: string,
  category: BudgetCategoryKey | null,
) {
  const userId = await requireUserId();
  const transaction = await ownedTransaction(userId, idSchema.parse(id));
  const parsedCategory = category === null ? null : categorySchema.parse(category);
  await prisma.financeTransaction.update({
    where: { id: transaction.id },
    data: {
      budgetCategory: parsedCategory as BudgetCategory | null,
      budgetCategorySource: "MANUAL",
    },
  });
  revalidateFinance();
}

export async function updateFinanceTransactionTagsAction(
  id: string,
  tagIds: string[],
) {
  const userId = await requireUserId();
  const transaction = await ownedTransaction(userId, idSchema.parse(id));
  const uniqueTags = [...new Set(z.array(idSchema).max(20).parse(tagIds))];
  const ownedTags = await prisma.financeTag.count({ where: { userId, id: { in: uniqueTags } } });
  if (ownedTags !== uniqueTags.length) throw new Error("Uma ou mais tags são inválidas.");
  await prisma.financeTransaction.update({
    where: { id: transaction.id },
    data: {
      tagAssignmentSource: "MANUAL",
      tags: {
        deleteMany: {},
        create: uniqueTags.map((tagId) => ({ tagId, source: "MANUAL" })),
      },
    },
  });
  revalidateFinance();
}

export async function setFinanceTransactionsIgnoredAction(ids: string[], ignored: boolean) {
  const userId = await requireUserId();
  const parsedIds = z.array(idSchema).min(1).max(500).parse(ids);
  const result = await prisma.financeTransaction.updateMany({
    where: { userId, id: { in: parsedIds }, deleted: false },
    data: { ignored: z.boolean().parse(ignored) },
  });
  if (result.count !== new Set(parsedIds).size) throw new Error("Uma ou mais transações são inválidas.");
  revalidateFinance();
}

export async function toggleFinanceInternalTransferAction(id: string) {
  const userId = await requireUserId();
  const transaction = await ownedTransaction(userId, idSchema.parse(id));
  await prisma.financeTransaction.update({
    where: { id: transaction.id },
    data: {
      internalTransfer: !transaction.internalTransfer,
      internalTransferSource: "MANUAL",
    },
  });
  revalidateFinance();
}

export async function applyFinanceTransactionClassificationToSimilarAction(id: string) {
  const userId = await requireUserId();
  const transaction = await ownedTransaction(userId, idSchema.parse(id));
  if (transaction.source !== "PLUGGY") {
    throw new Error("Apenas transações sincronizadas podem gerar regras automáticas.");
  }
  const tags = await prisma.financeTransactionTag.findMany({
    where: { transactionId: transaction.id },
    select: { tagId: true },
  });
  const rule = await learnFinanceClassificationRule(userId, transaction.id, {
    budgetCategory: transaction.budgetCategory,
    tagIds: tags.map((tag) => tag.tagId),
    internalTransfer: transaction.internalTransfer,
  });
  if (!rule) {
    throw new Error("Esta transação não possui comerciante, contraparte ou descrição adequada para criar uma regra.");
  }
  await classifyFinanceTransactionsForUser(userId);
  revalidateFinance();
}

export async function updateFinanceClassificationRuleAction(input: {
  id: string;
  enabled: boolean;
  assignsBudgetCategory: boolean;
  budgetCategory?: BudgetCategoryKey | null;
  assignsTags: boolean;
  tagIds: string[];
  assignsInternalTransfer: boolean;
  internalTransfer: boolean;
}) {
  const userId = await requireUserId();
  const parsed = z.object({
    id: idSchema,
    enabled: z.boolean(),
    assignsBudgetCategory: z.boolean(),
    budgetCategory: categorySchema.nullable().optional(),
    assignsTags: z.boolean(),
    tagIds: z.array(idSchema).max(20),
    assignsInternalTransfer: z.boolean(),
    internalTransfer: z.boolean(),
  }).parse(input);
  const rule = await prisma.financeClassificationRule.findFirst({
    where: { id: parsed.id, userId },
    select: { id: true },
  });
  if (!rule) throw new Error("Regra automática não encontrada.");
  const uniqueTagIds = [...new Set(parsed.tagIds)];
  const tagCount = await prisma.financeTag.count({ where: { userId, id: { in: uniqueTagIds } } });
  if (tagCount !== uniqueTagIds.length) throw new Error("Uma ou mais tags são inválidas.");

  await prisma.$transaction(async (tx) => {
    await tx.financeClassificationRule.update({
      where: { id: rule.id },
      data: {
        enabled: parsed.enabled,
        assignsBudgetCategory: parsed.assignsBudgetCategory,
        budgetCategory: parsed.assignsBudgetCategory
          ? (parsed.budgetCategory ?? null) as BudgetCategory | null
          : null,
        assignsTags: parsed.assignsTags,
        assignsInternalTransfer: parsed.assignsInternalTransfer,
        internalTransfer: parsed.internalTransfer,
      },
    });
    await tx.financeClassificationRuleTag.deleteMany({ where: { ruleId: rule.id } });
    if (parsed.assignsTags && uniqueTagIds.length) {
      await tx.financeClassificationRuleTag.createMany({
        data: uniqueTagIds.map((tagId) => ({ ruleId: rule.id, tagId })),
        skipDuplicates: true,
      });
    }
  });
  await classifyFinanceTransactionsForUser(userId);
  revalidateFinance();
}

export async function createFinanceDescriptionPrefixRuleAction(input: {
  prefix: string;
  kind: "INCOME" | "EXPENSE";
  assignsBudgetCategory: boolean;
  budgetCategory?: BudgetCategoryKey | null;
  tagIds: string[];
}) {
  const userId = await requireUserId();
  const parsed = z.object({
    prefix: z.string().trim().min(2).max(120),
    kind: z.enum(["INCOME", "EXPENSE"]),
    assignsBudgetCategory: z.boolean(),
    budgetCategory: categorySchema.nullable().optional(),
    tagIds: z.array(idSchema).max(20),
  }).parse(input);
  const matchValue = normalizeFinanceRuleValue("DESCRIPTION_PREFIX", parsed.prefix);
  if (matchValue.length < 2) throw new Error("Informe um prefixo válido.");
  const uniqueTagIds = [...new Set(parsed.tagIds)];
  if (!parsed.assignsBudgetCategory && !uniqueTagIds.length) {
    throw new Error("A regra precisa definir uma meta ou pelo menos uma tag.");
  }
  const tagCount = await prisma.financeTag.count({ where: { userId, id: { in: uniqueTagIds } } });
  if (tagCount !== uniqueTagIds.length) throw new Error("Uma ou mais tags são inválidas.");

  await prisma.$transaction(async (tx) => {
    const rule = await tx.financeClassificationRule.upsert({
      where: {
        userId_matchType_matchValue_kind: {
          userId,
          matchType: "DESCRIPTION_PREFIX",
          matchValue,
          kind: parsed.kind,
        },
      },
      update: {
        matchLabel: `${parsed.prefix.trim()}…`,
        enabled: true,
        assignsBudgetCategory: parsed.assignsBudgetCategory,
        budgetCategory: parsed.assignsBudgetCategory
          ? (parsed.budgetCategory ?? null) as BudgetCategory | null
          : null,
        assignsTags: uniqueTagIds.length > 0,
      },
      create: {
        userId,
        matchType: "DESCRIPTION_PREFIX",
        matchValue,
        matchLabel: `${parsed.prefix.trim()}…`,
        kind: parsed.kind,
        assignsBudgetCategory: parsed.assignsBudgetCategory,
        budgetCategory: parsed.assignsBudgetCategory
          ? (parsed.budgetCategory ?? null) as BudgetCategory | null
          : null,
        assignsTags: uniqueTagIds.length > 0,
      },
    });
    await tx.financeClassificationRuleTag.deleteMany({ where: { ruleId: rule.id } });
    if (uniqueTagIds.length) {
      await tx.financeClassificationRuleTag.createMany({
        data: uniqueTagIds.map((tagId) => ({ ruleId: rule.id, tagId })),
        skipDuplicates: true,
      });
    }
  });
  await classifyFinanceTransactionsForUser(userId);
  revalidateFinance();
}

export async function deleteFinanceClassificationRuleAction(id: string) {
  const userId = await requireUserId();
  const result = await prisma.financeClassificationRule.deleteMany({
    where: { id: idSchema.parse(id), userId },
  });
  if (!result.count) throw new Error("Regra automática não encontrada.");
  await classifyFinanceTransactionsForUser(userId);
  revalidateFinance();
}

export async function saveFinanceTransactionNoteAction(id: string, note: string) {
  const userId = await requireUserId();
  const transaction = await ownedTransaction(userId, idSchema.parse(id));
  const value = z.string().trim().max(2_000).parse(note);
  await prisma.financeTransaction.update({
    where: { id: transaction.id },
    data: { note: value || null },
  });
  revalidateFinance();
}

export async function saveFinanceTransactionManualFxAction(input: {
  id: string;
  rateToBrl: number;
  rateDate?: string;
}) {
  const userId = await requireUserId();
  const parsed = z.object({
    id: idSchema,
    rateToBrl: z.number().finite().positive().max(1_000_000),
    rateDate: z.string().date().optional(),
  }).parse(input);
  const transaction = await ownedTransaction(userId, parsed.id);
  const rate = new Prisma.Decimal(parsed.rateToBrl);
  await prisma.financeTransaction.update({
    where: { id: transaction.id },
    data: {
      fxRateToBrl: rate,
      fxRateDate: parsed.rateDate
        ? new Date(`${parsed.rateDate}T12:00:00.000Z`)
        : transaction.date,
      fxSource: "MANUAL",
      reportingAmountBrl: transaction.amount.mul(rate).toDecimalPlaces(2),
    },
  });
  revalidateFinance();
}

export async function resolvePendingPluggyDeletionAction(
  id: string,
  decision: "KEEP_MANUAL" | "REMOVE",
) {
  const userId = await requireUserId();
  const transaction = await ownedTransaction(userId, idSchema.parse(id));
  if (transaction.source !== "PLUGGY" || transaction.providerLifecycle !== "DELETION_PENDING") {
    throw new Error("Esta transação não está aguardando uma decisão.");
  }
  await prisma.financeTransaction.update({
    where: { id: transaction.id },
    data: decision === "KEEP_MANUAL"
      ? {
          source: "MANUAL",
          externalId: null,
          balanceApplied: false,
          providerLifecycle: "KEPT_MANUAL",
          providerDeletedAt: null,
          deleted: false,
        }
      : {
          providerLifecycle: "REMOVED",
          providerDeletedAt: transaction.providerDeletedAt ?? new Date(),
          deleted: true,
        },
  });
  revalidateFinance();
}

export async function deleteFinanceTransactionAction(id: string) {
  const userId = await requireUserId();
  const transaction = await ownedTransaction(userId, idSchema.parse(id));
  if (transaction.source !== "MANUAL") {
    await prisma.financeTransaction.update({
      where: { id: transaction.id },
      data: { deleted: true },
    });
    revalidateFinance();
    return;
  }
  await withSerializableRetry(async (tx) => {
    await lockOwnedActiveAccounts(tx, userId, [transaction.accountId]);
    const currentTransaction = await tx.financeTransaction.findFirstOrThrow({
      where: { id: transaction.id, userId, deleted: false },
    });
    if (currentTransaction.source !== "MANUAL") {
      throw new Error("A origem da transação mudou. Atualize a página e tente novamente.");
    }
    const account = await tx.financialAccount.findFirstOrThrow({
      where: { id: currentTransaction.accountId, userId, active: true },
    });
    if (account.source === "MANUAL" && currentTransaction.balanceApplied) {
      await adjustManualAccountBalance(
        tx,
        account.id,
        accountBalanceDelta(account.type, currentTransaction.amount).negated(),
      );
    }
    await tx.financeTransaction.delete({ where: { id: currentTransaction.id } });
  });
  revalidateFinance();
}
