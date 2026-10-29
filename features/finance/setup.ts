import { isPrismaTransactionConflict } from "@/lib/prisma-errors";
import { Prisma } from "@/generated/prisma/client";
import { BUDGET_CATEGORIES, type BudgetCategoryKey } from "@/features/budget/constants";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FINANCE_TAGS } from "./classification";
import type { FinanceGoalRecord } from "./types";

export const AUVP_FINANCE_GOALS: FinanceGoalRecord = {
  FIXED_COSTS: 30,
  COMFORT: 15,
  GOALS: 15,
  PLEASURES: 10,
  FINANCIAL_FREEDOM: 25,
  KNOWLEDGE: 5,
};

export const AUVP_FINANCE_TAGS = Object.entries(DEFAULT_FINANCE_TAGS).map(
  ([systemKey, tag]) => ({ systemKey, ...tag }),
);

export type FinanceSetupRepairPlan = {
  createProfile: boolean;
  createGoals: Array<{ category: BudgetCategoryKey; percentage: number }>;
  createTags: Array<{ systemKey: string; name: string; color: string }>;
  restoreTagKeys: Array<{ id: string; systemKey: string }>;
  conflicts: Array<{ id: string; name: string; systemKey: string; existingSystemKey: string }>;
};

/** Read-only preview; existing names, colors, goals and profile settings are kept. */
export async function previewFinanceSetupRepair(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<FinanceSetupRepairPlan> {
  const [profile, goals, tags] = await Promise.all([
    tx.financeProfile.findUnique({ where: { userId }, select: { id: true } }),
    tx.financeGoal.findMany({ where: { userId }, select: { category: true } }),
    tx.financeTag.findMany({ where: { userId }, select: { id: true, systemKey: true, name: true } }),
  ]);
  const categories = new Set(goals.map((goal) => goal.category));
  const tagKeys = new Set(tags.map((tag) => tag.systemKey));
  const tagsByName = new Map(tags.map((tag) => [tag.name, tag]));
  const plan: FinanceSetupRepairPlan = {
    createProfile: !profile,
    createGoals: BUDGET_CATEGORIES
      .filter((category) => !categories.has(category))
      .map((category) => ({ category, percentage: AUVP_FINANCE_GOALS[category] })),
    createTags: [],
    restoreTagKeys: [],
    conflicts: [],
  };

  for (const tag of AUVP_FINANCE_TAGS) {
    if (tagKeys.has(tag.systemKey)) continue;
    const sameName = tagsByName.get(tag.name);
    if (!sameName) {
      plan.createTags.push(tag);
    } else if (sameName.systemKey === null) {
      // Reuse a legacy tag, retaining its ID and every transaction association.
      plan.restoreTagKeys.push({ id: sameName.id, systemKey: tag.systemKey });
    } else {
      // Never steal another system tag's key or rename a customized tag.
      plan.conflicts.push({
        id: sameName.id,
        name: sameName.name,
        systemKey: tag.systemKey,
        existingSystemKey: sameName.systemKey,
      });
    }
  }
  return plan;
}

/** Explicit legacy repair or write-path fallback; never call from page loaders. */
export async function repairFinanceSetup(
  tx: Prisma.TransactionClient,
  userId: string,
  { apply = false }: { apply?: boolean } = {},
) {
  if (apply) {
    // Serialize setup repairs and financial settings changes on the same user row.
    const users = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
    `);
    if (!users.length) throw new Error("Usuário não encontrado.");
  }
  const plan = await previewFinanceSetupRepair(tx, userId);
  if (!apply) return plan;

  if (plan.createProfile) await tx.financeProfile.create({ data: { userId } });
  if (plan.createGoals.length) {
    await tx.financeGoal.createMany({ data: plan.createGoals.map((goal) => ({ userId, ...goal })) });
  }
  for (const tag of plan.restoreTagKeys) {
    await tx.financeTag.updateMany({
      where: { id: tag.id, userId, systemKey: null },
      data: { systemKey: tag.systemKey },
    });
  }
  if (plan.createTags.length) {
    await tx.financeTag.createMany({ data: plan.createTags.map((tag) => ({ userId, ...tag })) });
  }
  return plan;
}

export async function ensureFinanceSetup(userId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => repairFinanceSetup(tx, userId, { apply: true }));
    } catch (error) {
      // A tag may also be created/renamed outside the setup repair. Re-read after
      // a uniqueness race; the next plan reuses it instead of creating a duplicate.
      const retryable = isPrismaTransactionConflict(error)
        || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error("Não foi possível concluir a configuração financeira.");
}
