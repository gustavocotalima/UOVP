import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { resolveTransactionFx, resolveUpdatedTransactionFx } from "@/features/finance/fx-resolution";

describe("conversão reportável de transações", () => {
  it("prioriza o valor efetivamente cobrado em uma conta BRL", () => {
    const result = resolveTransactionFx({
      amountInAccountCurrency: new Decimal("-561.11"),
      accountCurrencyCode: "BRL",
      originalCurrencyCode: "PYG",
    });
    expect(result.reportingAmountBrl?.toString()).toBe("-561.11");
    expect(result.fxRateToBrl?.toString()).toBe("1");
    expect(result.fxSource).toBe("PLUGGY");
  });

  it("usa o fechamento histórico para uma conta estrangeira", () => {
    const rateDate = new Date("2026-07-17T00:00:00.000Z");
    const result = resolveTransactionFx({
      amountInAccountCurrency: new Decimal("-100"),
      accountCurrencyCode: "USD",
      originalCurrencyCode: "USD",
      rate: { rateDate, rateToBrl: new Decimal("5.4321") },
    });
    expect(result.reportingAmountBrl?.toString()).toBe("-543.21");
    expect(result.fxRateToBrl?.toString()).toBe("5.4321");
    expect(result.fxRateDate).toEqual(rateDate);
    expect(result.fxSource).toBe("YAHOO");
  });

  it("não presume paridade quando o câmbio está ausente", () => {
    const result = resolveTransactionFx({
      amountInAccountCurrency: new Decimal("-100"),
      accountCurrencyCode: "PYG",
      originalCurrencyCode: "PYG",
    });
    expect(result).toEqual({
      reportingAmountBrl: null,
      fxRateToBrl: null,
      fxRateDate: null,
      fxSource: null,
    });
  });
});

describe("correções de valor pelo provedor", () => {
  const date = new Date("2026-07-18T12:00:00Z");
  const previous = {
    currencyCode: "USD", date,
    fxRateToBrl: new Decimal(5), fxRateDate: new Date("2026-07-17T00:00:00Z"),
    fxSource: "YAHOO" as const,
  };
  const input = {
    amountInAccountCurrency: new Decimal(-120), accountCurrencyCode: "USD", originalCurrencyCode: "USD",
    transactionDate: date, previous,
    rate: { rateDate: date, rateToBrl: new Decimal(6) },
  };
  it("recalcula o produto sem trocar a taxa congelada, inclusive fechamento anterior", () => {
    const fx = resolveUpdatedTransactionFx(input);
    expect(fx.reportingAmountBrl?.toString()).toBe("-600");
    expect(fx.fxRateDate).toEqual(previous.fxRateDate);
    expect(fx.fxRateToBrl?.toString()).toBe("5");
  });
  it("usa a identidade BRL mesmo após correção do valor", () => {
    const fx = resolveUpdatedTransactionFx({ ...input, accountCurrencyCode: "BRL", originalCurrencyCode: "BRL" });
    expect(fx.reportingAmountBrl?.toString()).toBe("-120");
    expect(fx.fxSource).toBe("NATIVE");
  });
  it.each([
    { accountCurrencyCode: "EUR" },
    { transactionDate: new Date("2026-07-20T12:00:00Z") },
  ])("não reutiliza a taxa de outra moeda/data: %j", (change) => {
    const fx = resolveUpdatedTransactionFx({ ...input, ...change, rate: undefined });
    expect(fx.reportingAmountBrl).toBeNull();
    expect(fx.fxRateToBrl).toBeNull();
  });
});
