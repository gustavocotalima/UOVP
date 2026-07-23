import type { FixedIncomeIndexationKey, InstrumentTypeKey, InvestmentClassKey, RateConventionKey } from "./constants";

export type AssetHoldingDto = {
  id: string;
  catalogItemId: number | null;
  typeName: string;
  customTypeName: string | null;
  issuer: string;
  productName: string;
  pricingSource: "MANUAL" | "BRAPI";
  ticker: string | null;
  brapiAssetType: string | null;
  brapiSubType: string | null;
  currency: string;
  quantity: string;
  unitPrice: string;
  investedValue: string | null;
  currentValue: string;
  fractional: boolean;
  rateConvention: RateConventionKey | null;
  benchmark: string | null;
  rateValue: string | null;
  purchaseDate: string | null;
  maturityDate: string | null;
  logoUrl: string | null;
  priceUpdatedAt: string | null;
  updatedAt: string;
};

export type AssetDto = {
  id: string;
  investmentClass: InvestmentClassKey;
  instrumentType: InstrumentTypeKey;
  ticker: string;
  name: string;
  fixedIncomeFamilyCode: string | null;
  fixedIncomeFamilyName: string | null;
  fixedIncomeFamilyShortCode: string | null;
  indexation: FixedIncomeIndexationKey | null;
  logoUrl: string | null;
  currency: string;
  quantity: string;
  unitPrice: string;
  manualValue: string | null;
  currentValue: string;
  fractional: boolean;
  score: number;
  priceUpdatedAt: string | null;
  updatedAt: string;
  holdings: AssetHoldingDto[];
};

export type PortfolioDto = {
  id: string;
  version: number;
  targets: Record<InvestmentClassKey, number>;
  assets: AssetDto[];
  fixedIncomeFamilies: Array<{ code: string; name: string; shortCode: string; sortOrder: number }>;
  catalog: Array<{
    id: number;
    category: string;
    name: string;
    summary: string;
    familyCode: string | null;
  }>;
};

export type DiagramQuestionDto = {
  id: string;
  type: "CERRADO" | "REAL_ESTATE";
  criterion: string;
  text: string;
  active: boolean;
  isDefault: boolean;
  sortOrder: number;
};

export type SimulationDto = {
  id: string;
  requestedAmount: string;
  unallocatedAmount: string;
  suggestions: Array<{
    id: string;
    assetId: string;
    ticker: string;
    name: string;
    investmentClass: InvestmentClassKey;
    instrumentType: InstrumentTypeKey;
    quantity: string;
    value: string;
    suggestionPercentage: string;
    totalAfterSuggestionPercentage: string;
    executed: boolean;
  }>;
};
