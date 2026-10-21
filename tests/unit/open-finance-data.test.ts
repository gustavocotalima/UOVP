import { describe, expect, it } from "vitest";
import { sumAmountsByCurrency } from "@/features/open-finance/data";
import { currencyShare } from "@/features/open-finance/currency-totals";

describe("totais Open Finance por moeda", () => {
  it("mantém moedas separadas sem somar USD como BRL", () => {
    expect(sumAmountsByCurrency([
      { amount: "1000", currencyCode: "BRL" },
      { amount: "200", currencyCode: "usd" },
      { amount: 50, currencyCode: " BRL " },
    ])).toEqual({
      BRL: 1050,
      USD: 200,
    });
  });

  it("calcula participações apenas contra o total na mesma moeda", () => {
    const totals = sumAmountsByCurrency([
      { amount: "100", currencyCode: "BRL" }, { amount: "100", currencyCode: "USD" },
    ]);
    expect(totals).toEqual({ BRL: 100, USD: 100 });
    expect(currencyShare("100", "USD", totals)).toBe(100);
    expect(currencyShare("25", " brl ", totals)).toBe(25);
    expect(currencyShare("100", "EUR", totals)).toBeNull();
    expect(currencyShare("100", "USD", { USD: 0 })).toBeNull();
  });

  it("soma centavos antes de converter para a apresentação numérica", () => {
    expect(sumAmountsByCurrency([
      { amount: "0.10", currencyCode: "USD" }, { amount: "0.20", currencyCode: "USD" },
    ])).toEqual({ USD: 0.3 });
  });

  it("ignora valores não numéricos e assume BRL apenas quando a moeda está ausente", () => {
    expect(sumAmountsByCurrency([
      { amount: "inválido", currencyCode: "USD" },
      { amount: 25, currencyCode: null },
    ])).toEqual({ BRL: 25 });
  });
});
