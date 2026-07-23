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

const idSchema = z.string().min(1).max(200);
const categorySchema = z.enum(BUDGET_CATEGORIES);
const accountTypeSchema = z.enum(["BANK_ACCOUNT", "CREDIT_CARD"]);
const moneySchema = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

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
  name: string;
  institutionName?: string;
  accountNumber?: string;
  agency?: string;
  numberLastFour?: string;
  bankCode?: string;
  brand?: string;
  balance: number;
  creditLimit?: number | null;
  dueDay?: number | null;
  closingDay?: number | null;
}) {
  const userId = await requireUserId();
  const parsed = z
    .object({
      id: idSchema.optional(),
      type: accountTypeSchema,
      name: z.string().trim().min(2).max(120),
      institutionName: z.string().trim().max(120).optional(),
      accountNumber: z.string().trim().max(64).optional(),
      agency: z.string().trim().max(32).optional(),
      numberLastFour: z.string().trim().max(4).optional(),
      bankCode: z.string().trim().max(12).optional(),
      brand: z.string().trim().max(32).optional(),
      balance: moneySchema,
      creditLimit: z.number().finite().min(0).max(1_000_000_000).nullable().optional(),
      dueDay: z.number().int().min(1).max(31).nullable().optional(),
      closingDay: z.number().int().min(1).max(31).nullable().optional(),
    })
    .parse(input);
  const data = {
    type: parsed.type as FinancialAccountType,
    name: parsed.name,
    institutionName: parsed.institutionName || null,
    accountNumber: parsed.accountNumber || null,
    agency: parsed.agency || null,
    numberLastFour: parsed.numberLastFour || null,
    bankCode: parsed.bankCode || null,
    brand: parsed.brand || null,
    balance: parsed.balance,
    creditLimit: parsed.creditLimit ?? null,
    availableCredit:
      parsed.creditLimit == null
        ? null
        : Math.max(0, parsed.creditLimit - (parsed.type === "CREDIT_CARD" ? Math.abs(parsed.balance) : 0)),
    dueDay: parsed.dueDay ?? null,
    closingDay: parsed.closingDay ?? null,
  };
  if (parsed.id) {
    const account = await ownedAccount(userId, parsed.id);
    await prisma.financialAccount.update({
      where: { id: account.id },
      data: account.source === "MANUAL" ? data : { name: parsed.name },
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
        sortOrder: (max._max.sortOrder ?? -1) + 1,
        ...data,
      },
    });
  }
  revalidateFinance();
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

function balanceAdjustment(type: FinancialAccountType, amount: Prisma.Decimal) {
  return type === "CREDIT_CARD" ? amount.negated() : amount;
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
    })
    .parse(input);
  const account = await ownedAccount(userId, parsed.accountId);
  const tagIds = [...new Set(parsed.tagIds ?? [])];
  if (tagIds.length) {
    const ownedTags = await prisma.financeTag.count({ where: { userId, id: { in: tagIds } } });
    if (ownedTags !== tagIds.length) throw new Error("Uma ou mais tags são inválidas.");
  }
  const signedAmount = new Prisma.Decimal(parsed.amount).times(parsed.kind === "EXPENSE" ? -1 : 1);
  await prisma.$transaction(async (tx) => {
    await tx.financeTransaction.create({
      data: {
        userId,
        accountId: account.id,
        source: "MANUAL",
        kind: parsed.kind,
        description: parsed.description,
        amount: signedAmount,
        date: new Date(`${parsed.date}T12:00:00.000Z`),
        referenceYear: parsed.referenceYear,
        referenceMonth: parsed.referenceMonth,
        referenceOverridden: true,
        budgetCategory: parsed.budgetCategory ?? null,
        budgetCategorySource: "MANUAL",
        tagAssignmentSource: "MANUAL",
        note: parsed.note || null,
        tags: { create: tagIds.map((tagId) => ({ tagId, source: "MANUAL" })) },
      },
    });
    if (account.source === "MANUAL") {
      await tx.financialAccount.update({
        where: { id: account.id },
        data: { balance: { increment: balanceAdjustment(account.type, signedAmount) } },
      });
    }
  });
  revalidateFinance();
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
  const kind = parsed.kind ?? transaction.kind;
  const amount = parsed.amount
    ? new Prisma.Decimal(parsed.amount).times(kind === "EXPENSE" ? -1 : 1)
    : transaction.amount;
  await prisma.$transaction(async (tx) => {
    if (transaction.source === "MANUAL") {
      const oldAccount = await tx.financialAccount.findUniqueOrThrow({ where: { id: transaction.accountId } });
      const nextAccount = targetAccount ?? oldAccount;
      if (oldAccount.source === "MANUAL") {
        await tx.financialAccount.update({
          where: { id: oldAccount.id },
          data: { balance: { decrement: balanceAdjustment(oldAccount.type, transaction.amount) } },
        });
      }
      if (nextAccount.source === "MANUAL") {
        await tx.financialAccount.update({
          where: { id: nextAccount.id },
          data: { balance: { increment: balanceAdjustment(nextAccount.type, amount) } },
        });
      }
    }
    await tx.financeTransaction.update({
      where: { id: transaction.id },
      data: {
        ...(transaction.source === "MANUAL"
          ? {
              description: parsed.description ?? transaction.description,
              accountId: targetAccount?.id ?? transaction.accountId,
              amount,
              kind,
              date: parsed.date ? new Date(`${parsed.date}T12:00:00.000Z`) : transaction.date,
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

export async function deleteFinanceTransactionAction(id: string) {
  const userId = await requireUserId();
  const transaction = await ownedTransaction(userId, idSchema.parse(id));
  await prisma.$transaction(async (tx) => {
    if (transaction.source === "MANUAL") {
      const account = await tx.financialAccount.findUniqueOrThrow({ where: { id: transaction.accountId } });
      if (account.source === "MANUAL") {
        await tx.financialAccount.update({
          where: { id: account.id },
          data: { balance: { decrement: balanceAdjustment(account.type, transaction.amount) } },
        });
      }
      await tx.financeTransaction.delete({ where: { id: transaction.id } });
    } else {
      await tx.financeTransaction.update({ where: { id: transaction.id }, data: { deleted: true } });
    }
  });
  revalidateFinance();
}
