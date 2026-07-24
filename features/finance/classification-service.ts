import {
  type BudgetCategory,
  type FinanceClassificationMatchType,
  type FinanceTransactionKind,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  classifyProviderTransaction,
  DEFAULT_FINANCE_TAGS,
  financeDescriptionMatchesPrefix,
  financeRuleCandidates,
  preferredFinanceRuleCandidate,
  type DefaultFinanceTagKey,
} from "./classification";
import type { BudgetCategoryKey } from "@/features/budget/constants";

const CLASSIFICATION_BATCH_SIZE = 100;

export type FinanceClassificationSummary = {
  processed: number;
  metasAssigned: number;
  tagsAssigned: number;
  internalTransfersDetected: number;
  unclassified: number;
};

type LearnRuleInput = {
  budgetCategory?: BudgetCategoryKey | null;
  tagIds?: string[];
  internalTransfer?: boolean;
};

function ruleKey(
  kind: FinanceTransactionKind | "INCOME" | "EXPENSE",
  matchType: FinanceClassificationMatchType | string,
  matchValue: string,
) {
  return `${kind}:${matchType}:${matchValue}`;
}

async function ensureDefaultTags(
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  for (const [systemKey, tag] of Object.entries(DEFAULT_FINANCE_TAGS)) {
    const existing = await db.financeTag.findUnique({
      where: { userId_systemKey: { userId, systemKey } },
      select: { id: true },
    });
    if (existing) continue;
    await db.financeTag.upsert({
      where: { userId_name: { userId, name: tag.name } },
      update: { systemKey },
      create: { userId, systemKey, ...tag },
    });
  }
}

export async function classifyFinanceTransactionsForUser(
  userId: string,
  transactionIds?: string[],
  transactionClient?: Prisma.TransactionClient,
): Promise<FinanceClassificationSummary> {
  const db = transactionClient ?? prisma;
  await ensureDefaultTags(userId, db);
  const [transactions, rules, systemTags] = await Promise.all([
    db.financeTransaction.findMany({
      where: {
        userId,
        source: "PLUGGY",
        deleted: false,
        ...(transactionIds ? { id: { in: transactionIds } } : {}),
      },
      include: { tags: true },
    }),
    db.financeClassificationRule.findMany({
      where: { userId, enabled: true },
      include: { tags: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.financeTag.findMany({
      where: { userId, systemKey: { not: null } },
      select: { id: true, systemKey: true },
    }),
  ]);

  const rulesByKey = new Map(
    rules.map((rule) => [ruleKey(rule.kind, rule.matchType, rule.matchValue), rule]),
  );
  const prefixRules = rules
    .filter((rule) => rule.matchType === "DESCRIPTION_PREFIX")
    .sort((left, right) => right.matchValue.length - left.matchValue.length);
  const tagIdsByKey = new Map(
    systemTags
      .filter((tag): tag is { id: string; systemKey: string } => Boolean(tag.systemKey))
      .map((tag) => [tag.systemKey, tag.id]),
  );
  const summary: FinanceClassificationSummary = {
    processed: transactions.length,
    metasAssigned: 0,
    tagsAssigned: 0,
    internalTransfersDetected: 0,
    unclassified: 0,
  };
  const operations: Prisma.PrismaPromise<unknown>[] = [];

  for (const transaction of transactions) {
    const provider = classifyProviderTransaction(transaction);
    const exactRule = financeRuleCandidates(transaction)
      .map((candidate) => rulesByKey.get(ruleKey(transaction.kind, candidate.matchType, candidate.matchValue)))
      .find(Boolean);
    const matchedRule = exactRule ?? prefixRules.find(
      (rule) =>
        rule.kind === transaction.kind
        && financeDescriptionMatchesPrefix(transaction, rule.matchValue),
    );

    const budgetManual = transaction.budgetCategorySource === "MANUAL";
    const tagsManual = transaction.tagAssignmentSource === "MANUAL";
    const internalManual = transaction.internalTransferSource === "MANUAL";

    const budgetCategory = budgetManual
      ? transaction.budgetCategory
      : matchedRule?.assignsBudgetCategory
        ? matchedRule.budgetCategory
        : provider.budgetCategory;
    const budgetCategorySource = budgetManual
      ? "MANUAL"
      : matchedRule?.assignsBudgetCategory
        ? "USER_RULE"
        : provider.budgetCategory
          ? "PROVIDER_DEFAULT"
          : "UNASSIGNED";

    const internalTransfer = internalManual
      ? transaction.internalTransfer
      : matchedRule?.assignsInternalTransfer
        ? matchedRule.internalTransfer
        : provider.internalTransfer;
    const internalTransferSource = internalManual
      ? "MANUAL"
      : matchedRule?.assignsInternalTransfer
        ? "USER_RULE"
        : provider.internalTransfer
          ? "PROVIDER_DEFAULT"
          : "UNASSIGNED";

    const ruleTagIds = matchedRule?.assignsTags ? matchedRule.tags.map((tag) => tag.tagId) : null;
    const providerTagIds = provider.tagKeys
      .map((key: DefaultFinanceTagKey) => tagIdsByKey.get(key))
      .filter((id): id is string => Boolean(id));
    const automaticTagIds = tagsManual ? [] : (ruleTagIds ?? providerTagIds);
    const tagAssignmentSource = tagsManual
      ? "MANUAL"
      : matchedRule?.assignsTags
        ? "USER_RULE"
        : providerTagIds.length
          ? "PROVIDER_DEFAULT"
          : "UNASSIGNED";

    const appliedRule =
      matchedRule
      && (
        (!budgetManual && matchedRule.assignsBudgetCategory)
        || (!tagsManual && matchedRule.assignsTags)
        || (!internalManual && matchedRule.assignsInternalTransfer)
      )
        ? matchedRule
        : null;

    if (budgetCategory && budgetCategorySource !== "MANUAL") summary.metasAssigned += 1;
    summary.tagsAssigned += automaticTagIds.length;
    if (internalTransfer && internalTransferSource !== "MANUAL") summary.internalTransfersDetected += 1;
    if (
      transaction.kind === "EXPENSE"
      && !budgetCategory
      && budgetCategorySource === "UNASSIGNED"
      && !internalTransfer
    ) {
      summary.unclassified += 1;
    }

    operations.push(
      db.financeTransaction.update({
        where: { id: transaction.id },
        data: {
          budgetCategory: budgetCategory as BudgetCategory | null,
          budgetCategorySource,
          tagAssignmentSource,
          internalTransfer,
          internalTransferSource,
          classificationRuleId: appliedRule?.id ?? null,
          classifiedAt: new Date(),
          ...(!tagsManual
            ? {
                tags: {
                  deleteMany: { source: { not: "MANUAL" } },
                  create: automaticTagIds.map((tagId) => ({ tagId, source: tagAssignmentSource })),
                },
              }
            : {}),
        },
      }),
    );
  }

  for (let index = 0; index < operations.length; index += CLASSIFICATION_BATCH_SIZE) {
    const batch = operations.slice(index, index + CLASSIFICATION_BATCH_SIZE);
    if (transactionClient) await Promise.all(batch);
    else await prisma.$transaction(batch);
  }
  return summary;
}

export async function learnFinanceClassificationRule(
  userId: string,
  transactionId: string,
  input: LearnRuleInput,
) {
  const transaction = await prisma.financeTransaction.findFirst({
    where: { id: transactionId, userId, source: "PLUGGY", deleted: false },
  });
  if (!transaction) return null;
  const candidate = preferredFinanceRuleCandidate(transaction);
  if (!candidate) return null;

  const uniqueTagIds = [...new Set(input.tagIds ?? [])];
  if (input.tagIds) {
    const tagCount = await prisma.financeTag.count({ where: { userId, id: { in: uniqueTagIds } } });
    if (tagCount !== uniqueTagIds.length) throw new Error("Uma ou mais tags são inválidas.");
  }

  return prisma.$transaction(async (tx) => {
    const rule = await tx.financeClassificationRule.upsert({
      where: {
        userId_matchType_matchValue_kind: {
          userId,
          matchType: candidate.matchType as FinanceClassificationMatchType,
          matchValue: candidate.matchValue,
          kind: transaction.kind,
        },
      },
      update: {
        matchLabel: candidate.matchLabel,
        enabled: true,
        ...(Object.prototype.hasOwnProperty.call(input, "budgetCategory")
          ? {
              assignsBudgetCategory: true,
              budgetCategory: (input.budgetCategory ?? null) as BudgetCategory | null,
            }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "tagIds") ? { assignsTags: true } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "internalTransfer")
          ? {
              assignsInternalTransfer: true,
              internalTransfer: input.internalTransfer ?? false,
            }
          : {}),
      },
      create: {
        userId,
        matchType: candidate.matchType as FinanceClassificationMatchType,
        matchValue: candidate.matchValue,
        matchLabel: candidate.matchLabel,
        kind: transaction.kind,
        assignsBudgetCategory: Object.prototype.hasOwnProperty.call(input, "budgetCategory"),
        budgetCategory: (input.budgetCategory ?? null) as BudgetCategory | null,
        assignsTags: Object.prototype.hasOwnProperty.call(input, "tagIds"),
        assignsInternalTransfer: Object.prototype.hasOwnProperty.call(input, "internalTransfer"),
        internalTransfer: input.internalTransfer ?? false,
      },
    });
    if (input.tagIds) {
      await tx.financeClassificationRuleTag.deleteMany({ where: { ruleId: rule.id } });
      if (uniqueTagIds.length) {
        await tx.financeClassificationRuleTag.createMany({
          data: uniqueTagIds.map((tagId) => ({ ruleId: rule.id, tagId })),
          skipDuplicates: true,
        });
      }
    }
    return rule;
  });
}
