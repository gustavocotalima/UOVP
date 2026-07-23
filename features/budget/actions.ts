"use server";

import { revalidatePath } from "next/cache";
import { type BudgetCategory, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/current-user";
import { ensureBudgetMonth } from "./data";
import { BUDGET_CATEGORIES, type BudgetCategoryKey } from "./constants";

const categorySchema = z.enum(BUDGET_CATEGORIES);
const monthSchema = z.object({ year: z.number().int().min(2000).max(2200), month: z.number().int().min(1).max(12) });

export async function saveIncomeAction(year: number, month: number, income: number) {
  const userId = await requireUserId();
  const date = monthSchema.parse({ year, month });
  const value = z.number().min(0).max(1_000_000_000).parse(income);
  const budget = await ensureBudgetMonth(userId, date.year, date.month);
  await prisma.budgetMonth.update({ where: { id: budget.id }, data: { income: value } });
  revalidatePath("/orcamento-domestico");
  revalidatePath("/home");
}

export async function addExpenseAction(input: { year: number; month: number; name: string; amount: number; category: BudgetCategoryKey; recurring: boolean }) {
  const userId = await requireUserId();
  const parsed = z.object({ year: z.number().int(), month: z.number().int().min(1).max(12), name: z.string().trim().min(2).max(120), amount: z.number().positive().max(1_000_000_000), category: categorySchema, recurring: z.boolean() }).parse(input);
  const budget = await ensureBudgetMonth(userId, parsed.year, parsed.month);
  await prisma.$transaction(async (tx) => {
    let recurringExpenseId: string | undefined;
    if (parsed.recurring) {
      const recurring = await tx.recurringExpense.create({ data: { userId, name: parsed.name, amount: parsed.amount, category: parsed.category as BudgetCategory } });
      recurringExpenseId = recurring.id;
    }
    await tx.expense.create({ data: { budgetMonthId: budget.id, recurringExpenseId, name: parsed.name, amount: parsed.amount, category: parsed.category as BudgetCategory, spentAt: new Date(parsed.year, parsed.month - 1, 1) } });
  });
  revalidatePath("/orcamento-domestico");
  revalidatePath("/home");
}

export async function deleteExpenseAction(expenseId: string) {
  const userId = await requireUserId();
  const result = await prisma.expense.deleteMany({ where: { id: expenseId, budgetMonth: { userId } } });
  if (!result.count) throw new Error("Gasto não encontrado.");
  revalidatePath("/orcamento-domestico");
  revalidatePath("/home");
}

export async function updateExpenseAction(input: { id: string; name: string; amount: number; category: BudgetCategoryKey }) {
  const userId = await requireUserId();
  const parsed = z.object({ id: z.string().cuid(), name: z.string().trim().min(2).max(120), amount: z.number().positive().max(1_000_000_000), category: categorySchema }).parse(input);
  const updated = await prisma.expense.updateMany({ where: { id: parsed.id, budgetMonth: { userId } }, data: { name: parsed.name, amount: parsed.amount, category: parsed.category as BudgetCategory } });
  if (!updated.count) throw new Error("Gasto não encontrado.");
  revalidatePath("/orcamento-domestico");
  revalidatePath("/home");
}

export async function saveBudgetTargetsAction(year: number, month: number, targets: Record<BudgetCategoryKey, number>) {
  const userId = await requireUserId();
  const date = monthSchema.parse({ year, month });
  const parsed = z.record(categorySchema, z.number().min(0).max(100)).parse(targets);
  const total = BUDGET_CATEGORIES.reduce((sum, category) => sum + (parsed[category] ?? 0), 0);
  if (Math.abs(total - 100) > 0.001) throw new Error("As metas precisam totalizar 100%.");
  const budget = await ensureBudgetMonth(userId, date.year, date.month);
  await prisma.$transaction(BUDGET_CATEGORIES.map((category) => prisma.budgetTarget.upsert({ where: { budgetMonthId_category: { budgetMonthId: budget.id, category: category as BudgetCategory } }, update: { percentage: parsed[category] ?? 0 }, create: { budgetMonthId: budget.id, category: category as BudgetCategory, percentage: parsed[category] ?? 0 } })));
  revalidatePath("/orcamento-domestico");
}

export async function applyRecurringExpensesAction(year: number, month: number) {
  const userId = await requireUserId();
  const date = monthSchema.parse({ year, month });
  const budget = await ensureBudgetMonth(userId, date.year, date.month);
  const recurring = await prisma.recurringExpense.findMany({ where: { userId, active: true } });
  await prisma.expense.createMany({
    data: recurring.map((expense) => ({ budgetMonthId: budget.id, recurringExpenseId: expense.id, name: expense.name, amount: new Prisma.Decimal(expense.amount), category: expense.category, spentAt: new Date(year, month - 1, 1) })),
    skipDuplicates: true,
  });
  revalidatePath("/orcamento-domestico");
  revalidatePath("/home");
}
