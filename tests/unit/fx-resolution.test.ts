import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { resolveTransactionFx } from "@/features/finance/fx-resolution";

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
