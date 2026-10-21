import { describe, expect, it } from "vitest";
import { parseNumericDraft } from "@/lib/numeric-draft";
import { calculateFirstMillionResult, parseFirstMillionDrafts } from "@/features/balance-sheet/first-million-input";
import { investmentTargetsTotalCents, parseTargetDraft, parseTargetDrafts, targetPercentageCents, toTargetDrafts } from "@/features/portfolio/target-drafts";
import { DEFAULT_TARGETS } from "@/features/portfolio/constants";

describe("rascunhos numéricos", () => {
  it.each(["", " ", "-", "+", ".", "1e", "1e-", "NaN", "Infinity", "0x10", "1,5"])("não confirma vazio/intermediário/inválido %j como zero ou NaN", (draft) => {
    expect(parseNumericDraft(draft, { min: 0, max: 100 })).toBeNull();
  });

  it.each([["0", 0], ["0.00", 0], ["8.25", 8.25], [".5", 0.5], ["1e2", 100]])("confirma o decimal completo %s", (draft, value) => {
    expect(parseNumericDraft(draft, { min: 0, max: 100 })).toBe(value);
  });

  it("mantém limites existentes sem impor teto monetário adicional", () => {
    expect(parseFirstMillionDrafts({ annualRate: "0", initialValue: "0", desiredValue: "0" }))
      .toEqual({ annualRate: 0, initialValue: 0, desiredValue: 0 });
    expect(parseFirstMillionDrafts({ annualRate: "8", initialValue: "1e15", desiredValue: "1e16" }))
      .toEqual({ annualRate: 8, initialValue: 1e15, desiredValue: 1e16 });
    for (const invalid of ["", "-1", "1e309"]) {
      expect(parseFirstMillionDrafts({ annualRate: "8", initialValue: invalid, desiredValue: "1000000" })).toBeNull();
    }
    expect(parseFirstMillionDrafts({ annualRate: "100.01", initialValue: "1", desiredValue: "100" })).toBeNull();
  });

  it("preserva o fixture original e recusa somente projeção sem representação finita", () => {
    const result = calculateFirstMillionResult({ annualRate: 8, initialValue: 10000, desiredValue: 1000000 });
    expect(result?.matrix.find((row) => row.contribution === 50)?.values.find((point) => point.years === 10)?.value)
      .toBeCloseTo(30595.46, 2);
    const zero = calculateFirstMillionResult({ annualRate: 0, initialValue: 0, desiredValue: 0 });
    expect(zero?.monthlyRate).toBe(0);
    expect(zero?.matrix.find((row) => row.contribution === 50)?.values[0].value).toBe(6000);
    expect(calculateFirstMillionResult({ annualRate: 100, initialValue: 1e308, desiredValue: 1e308 })).toBeNull();
    expect(calculateFirstMillionResult({ annualRate: NaN, initialValue: 0, desiredValue: 0 })).toBeNull();
  });

  it("não confirma uma meta vazia mesmo quando sua interpretação indevida como zero somaria 100", () => {
    const drafts = toTargetDrafts(DEFAULT_TARGETS);
    expect(drafts.STORE_OF_VALUE).toBe("0");
    expect(parseTargetDrafts(drafts)).toEqual(DEFAULT_TARGETS);
    expect(parseTargetDrafts({ ...drafts, STORE_OF_VALUE: "" })).toBeNull();
    expect(parseTargetDrafts({ ...drafts, CRYPTO: "101" })).toBeNull();
    expect(parseTargetDrafts({ ...drafts, CRYPTO: "1e" })).toBeNull();
    expect(parseTargetDrafts({ ...drafts, CRYPTO: "0" })?.CRYPTO).toBe(0);
  });

  it("valida centésimos pelo decimal original sem rejeitar 0.29 por ponto flutuante", () => {
    expect(targetPercentageCents(0.29)).toBe(29);
    expect(targetPercentageCents(99.71)).toBe(9971);
    const exact = { ...DEFAULT_TARGETS, INTERNATIONAL_STOCKS: 0.29, BRAZILIAN_STOCKS: 99.71,
      REAL_ESTATE_FUNDS: 0, REITS: 0, CRYPTO: 0, FIXED_INCOME: 0, INTERNATIONAL_FIXED_INCOME: 0 };
    expect(investmentTargetsTotalCents(exact)).toBe(10_000);
    expect(parseTargetDrafts(toTargetDrafts(exact))).toEqual(exact);
    for (const draft of ["10.004", "20.004", "44.992", "10.00000000000000000001", "1e-3"]) {
      expect(parseTargetDraft(draft)).toBeNull();
    }
    expect(parseTargetDraft("10.2900")).toBe(10.29);
  });
});
