import { describe, expect, it } from "vitest";
import { aggregateHoldingValue, applyManualFixedIncomeContribution, parentPortfolioPercentage } from "@/features/portfolio/asset-groups";
import { allocateContribution } from "@/features/portfolio/allocation";

const targets = {
  INTERNATIONAL_STOCKS: 0,
  BRAZILIAN_STOCKS: 0,
  REAL_ESTATE_FUNDS: 0,
  REITS: 0,
  CRYPTO: 0,
  FIXED_INCOME: 100,
  INTERNATIONAL_FIXED_INCOME: 0,
} as const;

describe("grupos de ativos", () => {
  it("agrega posições manuais e de mercado e calcula o percentual do pai", () => {
    const value = aggregateHoldingValue([
      { currentValue: 1200, quantity: 0, unitPrice: 0 },
      { currentValue: null, quantity: 4, unitPrice: 75 },
    ]);

    expect(value.toNumber()).toBe(1500);
    expect(parentPortfolioPercentage(value, 6000).toNumber()).toBe(25);
  });

  it("mantém um grupo vazio elegível e trata renda fixa como ativo fracionário de R$ 1", () => {
    const result = allocateContribution({
      contribution: 500,
      targets,
      assets: [{
        id: "fixed-empty",
        ticker: "CDB-PRE",
        name: "Depósitos bancários com FGC · Pré-fixado",
        investmentClass: "FIXED_INCOME",
        currentValue: 0,
        quantity: 0,
        unitPrice: 1,
        score: 8,
        fractional: true,
      }],
    });

    expect(result.suggestions[0].value.toNumber()).toBe(500);
    expect(result.suggestions[0].quantity.toNumber()).toBe(500);
  });

  it("usa a exposição de renda fixa para um ETF e arredonda a quantidade em unidades inteiras", () => {
    const result = allocateContribution({
      contribution: 250,
      targets,
      assets: [{
        id: "aupo",
        ticker: "AUPO11",
        name: "AUPO11",
        investmentClass: "FIXED_INCOME",
        currentValue: 0,
        quantity: 0,
        unitPrice: 100,
        score: 8,
        fractional: false,
      }],
    });

    expect(result.suggestions[0].quantity.isInteger()).toBe(true);
    expect(result.suggestions[0].quantity.toNumber()).toBe(2);
    expect(result.unallocatedAmount.toNumber()).toBe(50);
  });

  it("incrementa valor investido e atual ao executar um aporte manual", () => {
    const result = applyManualFixedIncomeContribution({ investedValue: 900, currentValue: 950, amount: 100 });
    expect(result.investedValue.toNumber()).toBe(1000);
    expect(result.currentValue.toNumber()).toBe(1050);
  });

  it("usa quantidade Pluggy com preço brapi e recorre ao saldo do provedor sem cotação", () => {
    expect(aggregateHoldingValue([{
      pricingSource: "BRAPI",
      providerCurrentValue: 990,
      currentValue: null,
      quantity: 10,
      unitPrice: 105,
    }]).toNumber()).toBe(1050);
    expect(aggregateHoldingValue([{
      pricingSource: "BRAPI",
      providerCurrentValue: 990,
      currentValue: null,
      quantity: 10,
      unitPrice: 0,
    }]).toNumber()).toBe(990);
  });
});
