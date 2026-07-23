import { prisma } from "@/lib/prisma";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_META, type BudgetCategoryKey } from "./constants";

export async function ensureBudgetMonth(userId: string, year: number, month: number) {
  return prisma.budgetMonth.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: {},
    create: {
      userId,
      year,
      month,
      targets: { create: BUDGET_CATEGORIES.map((category) => ({ category, percentage: BUDGET_CATEGORY_META[category].defaultPercentage })) },
    },
  });
}

export async function getBudgetData(userId: string, year: number, month: number) {
  const budgetMonth = await ensureBudgetMonth(userId, year, month);
  const [monthData, recurringExpenses] = await Promise.all([
    prisma.budgetMonth.findUniqueOrThrow({
      where: { id: budgetMonth.id },
      include: { targets: true, expenses: { orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }] } },
    }),
    prisma.recurringExpense.findMany({ where: { userId, active: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    id: monthData.id,
    year,
    month,
    income: monthData.income.toString(),
    targets: Object.fromEntries(BUDGET_CATEGORIES.map((category) => [category, Number(monthData.targets.find((target) => target.category === category)?.percentage ?? 0)])) as Record<BudgetCategoryKey, number>,
    expenses: monthData.expenses.map((expense) => ({ id: expense.id, name: expense.name, amount: expense.amount.toString(), category: expense.category as BudgetCategoryKey, spentAt: expense.spentAt.toISOString(), recurringExpenseId: expense.recurringExpenseId })),
    recurringExpenses: recurringExpenses.map((expense) => ({ id: expense.id, name: expense.name, amount: expense.amount.toString(), category: expense.category as BudgetCategoryKey })),
  };
}

export async function getBudgetHistory(userId: string) {
  const months = await prisma.budgetMonth.findMany({ where: { userId }, orderBy: [{ year: "desc" }, { month: "desc" }], take: 12, include: { expenses: { select: { amount: true } } } });
  return months.reverse().map((item) => ({
    month: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(item.year, item.month - 1, 1)).replace(".", ""),
    income: Number(item.income),
    spent: item.expenses.reduce((sum, expense) => sum + Number(expense.amount), 0),
  }));
}
