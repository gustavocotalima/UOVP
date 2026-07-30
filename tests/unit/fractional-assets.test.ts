import { describe, expect, it } from "vitest";
import { allocateContribution } from "@/features/portfolio/allocation";
import { allowsFractionalUnits } from "@/features/portfolio/fractional-assets";
import { DEFAULT_TARGETS } from "@/features/portfolio/constants";

describe("ativos fracionários por mercado", () => {
  it("permite frações para ações e ETFs internacionais", () => {
    expect(allowsFractionalUnits({
      instrumentType: "STOCK",
      investmentClass: "INTERNATIONAL_STOCKS",
      pricingSource: "YAHOO",
    })).toBe(true);
    expect(allowsFractionalUnits({
      instrumentType: "ETF",
      investmentClass: "INTERNATIONAL_STOCKS",
      pricingSource: "YAHOO",
    })).toBe(true);
  });

  it("mantém ações e ETFs da B3 em unidades inteiras", () => {
    expect(allowsFractionalUnits({
      instrumentType: "STOCK",
      investmentClass: "BRAZILIAN_STOCKS",
      pricingSource: "BRAPI",
    })).toBe(false);
    expect(allowsFractionalUnits({
      instrumentType: "ETF",
      investmentClass: "FIXED_INCOME",
      pricingSource: "BRAPI",
    })).toBe(false);
  });

  it("sugere uma fração quando o aporte não compra uma unidade internacional inteira", () => {
    const fractional = allowsFractionalUnits({
      instrumentType: "ETF",
      investmentClass: "INTERNATIONAL_STOCKS",
      pricingSource: "YAHOO",
    });
    const result = allocateContribution({
      contribution: 100,
      targets: {
        ...DEFAULT_TARGETS,
        INTERNATIONAL_STOCKS: 100,
        BRAZILIAN_STOCKS: 0,
        REAL_ESTATE_FUNDS: 0,
        REITS: 0,
        CRYPTO: 0,
        FIXED_INCOME: 0,
        INTERNATIONAL_FIXED_INCOME: 0,
      },
      assets: [{
        id: "voo",
        ticker: "VOO",
        name: "Vanguard S&P 500 ETF",
        investmentClass: "INTERNATIONAL_STOCKS",
        currentValue: 0,
        quantity: 0,
        unitPrice: 2_500,
        score: 10,
        fractional,
      }],
    });

    expect(result.suggestions[0].value.toNumber()).toBe(100);
    expect(result.suggestions[0].quantity.toNumber()).toBe(0.04);
    expect(result.unallocatedAmount.toNumber()).toBe(0);
  });
});
