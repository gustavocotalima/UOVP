import { describe, expect, it } from "vitest";
import {
  assetCanReceiveContribution,
  currencyOnlyContributionScope,
  defaultContributionScope,
  isContributionScopeValid,
} from "@/features/portfolio/contribution-scope";

const asset = (currency: string, pricingSource = "BRAPI", instrumentType = "STOCK") => ({
  nativeCurrency: currency === "BRL" ? null : currency,
  instrumentType,
  holdings: [{ currency, pricingSource }],
});

describe("escopo de ativos para aporte", () => {
  it("preserva todos os ativos como padrão em BRL e restringe USD por padrão", () => {
    expect(defaultContributionScope("BRL")).toBe("ALL_ASSETS");
    expect(defaultContributionScope("USD")).toBe("USD_ONLY");
    expect(currencyOnlyContributionScope("BRL")).toBe("BRL_ONLY");
  });

  it("permite ativos em BRL no escopo BRL e exclui ativos em USD", () => {
    expect(assetCanReceiveContribution(asset("BRL"), "BRL_ONLY")).toBe(true);
    expect(assetCanReceiveContribution({ nativeCurrency: null, instrumentType: "FIXED_INCOME", holdings: [] }, "BRL_ONLY")).toBe(true);
    expect(assetCanReceiveContribution(asset("USD", "YAHOO"), "BRL_ONLY")).toBe(false);
    expect(isContributionScopeValid("BRL", "BRL_ONLY")).toBe(true);
  });

  it("mantém a validação dos ativos internacionais em USD", () => {
    expect(assetCanReceiveContribution(asset("USD", "YAHOO"), "USD_ONLY")).toBe(true);
    expect(assetCanReceiveContribution(asset("USD", "MANUAL"), "USD_ONLY")).toBe(false);
  });

  it("aceita todos os ativos somente no escopo geral", () => {
    expect(assetCanReceiveContribution(asset("USDT", "BINANCE", "CRYPTO"), "ALL_ASSETS")).toBe(true);
    expect(isContributionScopeValid("BRL", "ALL_ASSETS")).toBe(true);
    expect(isContributionScopeValid("BRL", "USD_ONLY")).toBe(false);
  });
});
