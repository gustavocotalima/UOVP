import { describe, expect, it } from "vitest";
import { accountInvestmentReviewSchema } from "@/features/finance/account-investments";
import { assetCanReceiveContribution } from "@/features/portfolio/contribution-scope";
import { holdingCurrentValue, holdingCurrentValueNative } from "@/features/portfolio/asset-groups";

const valid = {
  linkId: "cmaccountbalance000000000001", expectedUpdatedAt: "2026-10-17T12:00:00.000Z",
  investmentClass: "FIXED_INCOME", familyCode: "PAYMENT_ACCOUNT_RESERVES", indexation: "OTHER", score: 7,
};

describe("classificação de saldo de conta", () => {
  it("permite tipo personalizado e taxa desconhecida sem presumir CDI ou FGC", () => {
    const parsed = accountInvestmentReviewSchema.parse(valid);
    expect(parsed.customTypeName).toBe("Saldo de conta remunerado");
    expect(parsed.rateConvention).toBeNull();
    expect(parsed.benchmark).toBeNull();
  });
  it.each([
    { rateConvention: "FIXED_ANNUAL", rateValue: 12 },
    { rateConvention: "PERCENT_OF_INDEXER", rateValue: 100, benchmark: "CDI" },
    { rateConvention: "INDEXER_PLUS", rateValue: 3, benchmark: "IPCA" },
  ])("aceita taxa descritiva $rateConvention", (rate) => {
    expect(accountInvestmentReviewSchema.safeParse({ ...valid, ...rate }).success).toBe(true);
  });
  it.each([
    { rateConvention: "FIXED_ANNUAL" },
    { rateConvention: "PERCENT_OF_INDEXER", rateValue: 100 },
    { rateConvention: "FIXED_ANNUAL", rateValue: 12, benchmark: "CDI" },
    { rateValue: 12 }, { score: 31 }, { customTypeName: "" },
    { investmentClass: "BRAZILIAN_STOCKS" },
  ])("rejeita classificação inconsistente %j", (overrides) => {
    expect(accountInvestmentReviewSchema.safeParse({ ...valid, ...overrides }).success).toBe(false);
  });
  it("avalia saldo USD com câmbio corrente sem inventar principal", () => {
    const holding = { pricingSource: "ACCOUNT_BALANCE" as const, currency: "USD", quantity: "100", unitPrice: "1", currentValue: "100", fxRateToBrl: "5.25" };
    expect(holdingCurrentValue(holding).toString()).toBe("525");
    expect(holdingCurrentValueNative(holding)?.toString()).toBe("100");
  });
  it("inclui conta USD em sugestões USD e impede aporte sem câmbio", () => {
    const asset = { nativeCurrency: "USD", instrumentType: "FIXED_INCOME", holdings: [{ currency: "USD", pricingSource: "ACCOUNT_BALANCE", fxRateToBrl: "5" }] };
    expect(assetCanReceiveContribution(asset, "USD_ONLY")).toBe(true);
    expect(assetCanReceiveContribution(asset, "BRL_ONLY")).toBe(false);
    expect(assetCanReceiveContribution({ ...asset, holdings: [{ ...asset.holdings[0], fxRateToBrl: null }] }, "ALL_ASSETS")).toBe(false);
  });
  it("o equivalente BRL fecha nos mesmos centavos do saldo da conta", () => {
    expect(holdingCurrentValue({ pricingSource: "ACCOUNT_BALANCE", currency: "USD", quantity: "100", unitPrice: "1", currentValue: "100", fxRateToBrl: "5.123456" }).toFixed(2)).toBe("512.35");
  });
});
