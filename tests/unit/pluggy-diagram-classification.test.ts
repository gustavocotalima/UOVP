import { describe, expect, it } from "vitest";
import {
  applyExistingAssetClassification,
  classifyPluggyInvestment,
  fundAssetCode,
  isPluggyPositionActive,
  isPluggyPositionSold,
  normalizePluggyTicker,
} from "@/features/open-finance/diagram-classification";

function investment(overrides: Partial<Parameters<typeof classifyPluggyInvestment>[0]> = {}) {
  return {
    id: "local-id",
    pluggyInvestmentId: "11111111-2222-3333-4444-555555555555",
    name: "Produto",
    code: null,
    type: "FIXED_INCOME",
    subtype: "CDB",
    rateType: "CDI",
    rate: 100,
    fixedAnnualRate: null,
    ...overrides,
  };
}

describe("Pluggy diagram classification", () => {
  it("maps fixed-income subtype and indexation", () => {
    expect(classifyPluggyInvestment(investment())).toMatchObject({
      instrumentType: "FIXED_INCOME",
      investmentClass: "FIXED_INCOME",
      familyCode: "BANK_DEPOSITS_FGC",
      indexation: "POST_FIXED",
      catalogItemId: 5,
      needsReview: false,
    });
    expect(classifyPluggyInvestment(investment({
      rateType: null,
      fixedAnnualRate: 14.3,
    }))).toMatchObject({
      indexation: "PRE_FIXED",
      rateConvention: "FIXED_ANNUAL",
      rateValue: "14.3",
      needsReview: false,
    });
  });

  it("treats FIXED_INCOME without an explicit indexer as pre-fixed", () => {
    expect(classifyPluggyInvestment(investment({
      name: "CDB QISTA",
      rateType: null,
      rate: null,
      fixedAnnualRate: null,
    }))).toMatchObject({
      familyCode: "BANK_DEPOSITS_FGC",
      indexation: "PRE_FIXED",
      needsReview: false,
    });
  });

  it("maps deterministic fund exposure and reviews generic funds", () => {
    expect(classifyPluggyInvestment(investment({
      type: "MUTUAL_FUND",
      subtype: "FIXED_INCOME_FUND",
    }))).toMatchObject({
      instrumentType: "MUTUAL_FUND",
      investmentClass: "FIXED_INCOME",
      needsReview: false,
    });
    expect(classifyPluggyInvestment(investment({
      type: "MUTUAL_FUND",
      subtype: "MULTIMARKET_FUND",
    }))).toMatchObject({
      instrumentType: "MUTUAL_FUND",
      investmentClass: null,
      needsReview: true,
    });
  });

  it("preserves AUPO11's explicit override while correcting an automatic ETF", () => {
    const pluggyStock = classifyPluggyInvestment(investment({
      type: "EQUITY",
      subtype: "STOCK",
      code: "AUPO11",
    }));
    expect(applyExistingAssetClassification(pluggyStock, {
      instrumentType: "ETF",
      instrumentSource: "EXISTING_OVERRIDE",
      investmentClass: "FIXED_INCOME",
      fixedIncomeFamilyCode: "PUBLIC_TREASURY",
      indexation: "OTHER",
    })).toMatchObject({
      instrumentType: "ETF",
      investmentClass: "FIXED_INCOME",
      familyCode: "PUBLIC_TREASURY",
      indexation: "OTHER",
    });

    const pluggyEtf = classifyPluggyInvestment(investment({
      type: "ETF",
      subtype: "ETF",
      code: "GOLD11",
    }));
    expect(applyExistingAssetClassification(pluggyEtf, {
      instrumentType: "STOCK",
      instrumentSource: "AUTO",
      investmentClass: "BRAZILIAN_STOCKS",
      fixedIncomeFamilyCode: null,
      indexation: null,
    })).toMatchObject({
      instrumentType: "ETF",
      investmentClass: "BRAZILIAN_STOCKS",
      needsReview: false,
    });
  });

  it("normalizes ticker suffixes and groups funds by CNPJ", () => {
    expect(normalizePluggyTicker("EMBJ3.SA")).toBe("EMBJ3");
    expect(fundAssetCode(investment({ code: "12.345.678/0001-90" }))).toBe("FND-12345678000190");
  });

  it("uses TOTAL_WITHDRAWAL—not a zero balance—as the sold signal", () => {
    expect(isPluggyPositionSold({ status: "TOTAL_WITHDRAWAL" })).toBe(true);
    expect(isPluggyPositionSold({ status: "ACTIVE" })).toBe(false);
    expect(isPluggyPositionActive({ status: "ACTIVE", providerAvailable: true })).toBe(true);
    expect(isPluggyPositionActive({ status: "PENDING", providerAvailable: true })).toBe(false);
    expect(isPluggyPositionActive({ status: "ACTIVE", providerAvailable: false })).toBe(false);
  });
});
