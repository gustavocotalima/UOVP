import { describe, expect, it } from "vitest";
import { sumAmountsByCurrency } from "@/features/open-finance/data";

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

  it("ignora valores não numéricos e assume BRL apenas quando a moeda está ausente", () => {
    expect(sumAmountsByCurrency([
      { amount: "inválido", currencyCode: "USD" },
      { amount: 25, currencyCode: null },
    ])).toEqual({ BRL: 25 });
  });
});
