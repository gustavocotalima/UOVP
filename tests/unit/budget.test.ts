import { describe, expect, it } from "vitest";
import { budgetCategorySummary } from "@/features/budget/calculations";

describe("orçamento", () => {
  it("calcula alvo, utilização e saldo", () => {
    const result = budgetCategorySummary(10000, 30, 2400);
    expect(result.targetAmount.toNumber()).toBe(3000);
    expect(result.utilizedPercentage.toNumber()).toBe(80);
    expect(result.remainingAmount.toNumber()).toBe(600);
  });

  it("não divide por zero", () => {
    expect(budgetCategorySummary(0, 30, 100).utilizedPercentage.toNumber()).toBe(0);
  });
});
