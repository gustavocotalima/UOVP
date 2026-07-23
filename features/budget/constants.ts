export const BUDGET_CATEGORIES = [
  "FIXED_COSTS",
  "COMFORT",
  "GOALS",
  "PLEASURES",
  "FINANCIAL_FREEDOM",
  "KNOWLEDGE",
] as const;

export type BudgetCategoryKey = (typeof BUDGET_CATEGORIES)[number];

export const BUDGET_CATEGORY_META: Record<BudgetCategoryKey, { label: string; color: string; defaultPercentage: number }> = {
  FIXED_COSTS: { label: "Custos fixos", color: "#d2ad50", defaultPercentage: 30 },
  COMFORT: { label: "Conforto", color: "#76b7b2", defaultPercentage: 10 },
  GOALS: { label: "Metas", color: "#9b72cf", defaultPercentage: 20 },
  PLEASURES: { label: "Prazeres", color: "#ec6f66", defaultPercentage: 10 },
  FINANCIAL_FREEDOM: { label: "Liberdade financeira", color: "#59a14f", defaultPercentage: 25 },
  KNOWLEDGE: { label: "Conhecimento", color: "#4f86f7", defaultPercentage: 5 },
};

export const DEFAULT_BUDGET_TARGETS = Object.fromEntries(
  BUDGET_CATEGORIES.map((category) => [category, BUDGET_CATEGORY_META[category].defaultPercentage]),
) as Record<BudgetCategoryKey, number>;
