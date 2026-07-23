import { describe, expect, it } from "vitest";
import { effectiveMonthlyRate, futureValue } from "@/features/portfolio/calculations";

describe("primeiro milhão", () => {
  it("converte a taxa anual efetiva sem arredondar o cálculo", () => {
    expect(effectiveMonthlyRate(8).times(100).toNumber()).toBeCloseTo(0.643403011000343, 12);
  });

  it("reproduz o fixture de R$ 50 por 10 anos", () => {
    expect(futureValue(10000, 50, 8, 10).toDecimalPlaces(2).toNumber()).toBe(30595.46);
  });

  it("trata taxa zero", () => {
    expect(futureValue(10000, 100, 0, 10).toNumber()).toBe(22000);
  });
});
