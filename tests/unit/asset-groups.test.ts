import { describe, expect, it } from "vitest";
import {
  aggregateHoldingValue,
  applyManualFixedIncomeContribution,
  fixedIncomeHoldingFingerprint,
  holdingCurrentValue,
  parentPortfolioPercentage,
} from "@/features/portfolio/asset-groups";
import { allocateContribution } from "@/features/portfolio/allocation";

const targets = {
  INTERNATIONAL_STOCKS: 0,
  BRAZILIAN_STOCKS: 0,
  REAL_ESTATE_FUNDS: 0,
  REITS: 0,
  CRYPTO: 0,
  FIXED_INCOME: 100,
  INTERNATIONAL_FIXED_INCOME: 0,
  STORE_OF_VALUE: 0,
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

  it("converte a cotação nativa do Yahoo para BRL e não trata saldo estrangeiro sem FX como BRL", () => {
    expect(holdingCurrentValue({
      pricingSource: "YAHOO",
      currency: "USD",
      quantity: 2,
      unitPrice: 100,
      fxRateToBrl: 5.25,
      providerCurrentValue: 900,
    }).toNumber()).toBe(1050);

    expect(holdingCurrentValue({
      pricingSource: "YAHOO",
      currency: "USD",
      quantity: 2,
      unitPrice: 100,
      fxRateToBrl: null,
      providerCurrentValue: 900,
    }).toNumber()).toBe(0);
  });

  it("converte pares Binance em USDT para BRL e não mistura valor nativo sem câmbio", () => {
    expect(holdingCurrentValue({
      pricingSource: "BINANCE",
      currency: "USDT",
      quantity: 40,
      unitPrice: 0.5,
      fxRateToBrl: 5.25,
      currentValue: 80,
    }).toNumber()).toBe(105);

    expect(holdingCurrentValue({
      pricingSource: "BINANCE",
      currency: "USDT",
      quantity: 40,
      unitPrice: 0.5,
      fxRateToBrl: null,
      currentValue: 80,
    }).toNumber()).toBe(0);
  });

  it("converte saldos Pluggy não cotados quando há FX explícito", () => {
    expect(holdingCurrentValue({
      pricingSource: "PLUGGY",
      currency: "USD",
      quantity: 0,
      unitPrice: 0,
      fxRateToBrl: 5,
      providerCurrentValue: 200,
    }).toNumber()).toBe(1000);
  });

  it("gera fingerprint estável para reimportar a mesma aplicação de renda fixa", () => {
    const original = fixedIncomeHoldingFingerprint({
      catalogItemId: 12,
      issuer: "Banco Ágil",
      productName: "CDB Premium",
      purchaseDate: new Date("2026-01-10T00:00:00.000Z"),
      maturityDate: new Date("2028-01-10T00:00:00.000Z"),
    });
    const retried = fixedIncomeHoldingFingerprint({
      catalogItemId: 12,
      issuer: "  banco agil ",
      productName: "cdb   premium",
      purchaseDate: new Date("2026-01-10T00:00:00.000Z"),
      maturityDate: new Date("2028-01-10T00:00:00.000Z"),
    });

    expect(retried).toBe(original);
  });
});
