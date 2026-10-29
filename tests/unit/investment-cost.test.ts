import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { addInvestmentCost, investmentCostUpdate } from "@/features/portfolio/investment-cost";

describe("custos de investimento com unidade explícita", () => {
  it("preserva campos omitidos e limpa o par somente quando solicitado", () => {
    expect(investmentCostUpdate({})).toEqual({});
    expect(investmentCostUpdate({ investedValue: null })).toEqual({ investedValue: null, investedValueCurrency: null });
    expect(investmentCostUpdate({ investedValue: 0, investedValueCurrency: "usd" }))
      .toEqual({ investedValue: new Prisma.Decimal(0), investedValueCurrency: "USD" });
  });

  it.each([
    { investedValue: 100 },
    { investedValueCurrency: "BRL" },
    { investedValue: null, investedValueCurrency: "USD" },
    { investedValue: Number.NaN, investedValueCurrency: "BRL" },
  ])("rejeita pares incompletos ou inválidos: %j", (input) => {
    expect(() => investmentCostUpdate(input)).toThrow();
  });

  const additions = new Map([["BRL", new Prisma.Decimal(500)], ["USD", new Prisma.Decimal(100)]]);

  it.each(["BRL", "USD"])("soma somente na base %s compatível", (currency) => {
    const next = addInvestmentCost({ investedValue: new Prisma.Decimal(1_000), investedValueCurrency: currency, hasPriorPosition: true, additions });
    expect(next.investedValue?.toString()).toBe(currency === "BRL" ? "1500" : "1100");
    expect(next.investedValueCurrency).toBe(currency);
  });

  it("não transforma um novo aporte no custo completo de uma posição antiga desconhecida", () => {
    expect(addInvestmentCost({ investedValue: null, investedValueCurrency: null, hasPriorPosition: true, additions }))
      .toEqual({ investedValue: null, investedValueCurrency: null });
    expect(addInvestmentCost({ investedValue: null, investedValueCurrency: null, hasPriorPosition: false, additions }))
      .toEqual({ investedValue: new Prisma.Decimal(500), investedValueCurrency: "BRL" });
  });

  it("rejeita soma BRL em custo estrangeiro sem conversão histórica compatível", () => {
    expect(() => addInvestmentCost({
      investedValue: new Prisma.Decimal(1_000), investedValueCurrency: "USD", hasPriorPosition: true,
      additions: new Map([["BRL", new Prisma.Decimal(500)]]),
    })).toThrow("não é compatível");
  });
});
