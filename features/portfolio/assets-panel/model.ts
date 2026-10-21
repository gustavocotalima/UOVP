import type { BrapiTickerSearchResult } from "../brapi";
import type { BinanceAssetSearchResult } from "../binance";
import type { YahooSearchKind, YahooTickerSearchResult } from "../yahoo-finance";
import { type FixedIncomeIndexationKey, type InstrumentTypeKey, type InvestmentClassKey, type RateConventionKey } from "../constants";
import type { AssetDto, DiagramQuestionDto, PortfolioDto } from "../types";
export type FormAsset = {
  id?: string;
  instrumentType: InstrumentTypeKey;
  ticker: string;
  name: string;
  investmentClass: InvestmentClassKey;
  quantity: number;
  unitPrice: number;
  manualValue: number | null;
  currency: string;
  fractional: boolean;
  score: number;
  fixedIncomeFamilyCode: string | null;
  indexation: FixedIncomeIndexationKey | null;
  marketRegion: "BRAZIL" | "INTERNATIONAL" | null;
  yahooReitConfirmed: boolean;
};
export type QuantityEditForm = {
  linkId: string;
  expectedUpdatedAt: string;
  expectedProviderQuantity: string | null;
  holdingId: string;
  label: string;
  step: number;
  mode: "PROVIDER" | "CUSTOM";
  value: string;
  originalMode: "PROVIDER" | "CUSTOM";
  originalValue: string;
};
export type MarketTickerOption = (BrapiTickerSearchResult & {
  provider: "BRAPI";
}) | (YahooTickerSearchResult & {
  provider: "YAHOO";
}) | (BinanceAssetSearchResult & {
  provider: "BINANCE";
});
export type MarketTickerSearch = {
  provider: "BRAPI";
  kind: InvestmentClassKey | "ETF";
} | {
  provider: "YAHOO";
  kind: YahooSearchKind;
} | {
  provider: "BINANCE";
  kind: "CRYPTO";
};
export type DeleteTarget = {
  kind: "asset";
  id: string;
  label: string;
} | {
  kind: "class";
  investmentClass: InvestmentClassKey;
  label: string;
} | {
  kind: "holding";
  id: string;
  label: string;
};
export type FixedIncomeGroupForm = {
  id?: string;
  familyCode: string;
  indexation: FixedIncomeIndexationKey;
  investmentClass: "FIXED_INCOME" | "INTERNATIONAL_FIXED_INCOME";
  score: number;
};
export type HoldingForm = {
  id?: string;
  assetId: string;
  catalogItemId: number | null;
  customTypeName: string;
  issuer: string;
  productName: string;
  investedValue: number | null;
  currentValue: number;
  rateConvention: RateConventionKey | null;
  benchmark: string;
  rateValue: number | null;
  purchaseDate: string;
  maturityDate: string;
};
export type TickerListPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  transform?: string;
};
export type ReviewForm = PortfolioDto["integrationReview"][number] & {
  instrumentType: InstrumentTypeKey | "";
  investmentClass: InvestmentClassKey | "";
  marketRegion: "BRAZIL" | "INTERNATIONAL" | "";
  familyCode: string;
  indexation: FixedIncomeIndexationKey | "";
  score: number;
  accountCustomTypeName?: string;
  accountCatalogItemId?: number | null;
  accountRateConvention?: RateConventionKey | null;
  accountBenchmark?: string;
  accountRateValue?: string;
  confirmDistinctAutomaticBalance?: boolean;
};
export const emptyAsset: FormAsset = {
  instrumentType: "STOCK",
  ticker: "",
  name: "",
  investmentClass: "BRAZILIAN_STOCKS",
  quantity: 0,
  unitPrice: 0,
  manualValue: null,
  currency: "BRL",
  fractional: false,
  score: 0,
  fixedIncomeFamilyCode: null,
  indexation: null,
  marketRegion: null,
  yahooReitConfirmed: false,
};
export const emptyFixedGroup: FixedIncomeGroupForm = { familyCode: "", indexation: "PRE_FIXED", investmentClass: "FIXED_INCOME", score: 0 };
export function currentValue(asset: AssetDto) {
  return Number(asset.currentValue);
}
export function marketTickerSearchFor(form: FormAsset | null): MarketTickerSearch | null {
  if (!form || form.id)
    return null;
  if (form.instrumentType === "ETF" && form.investmentClass === "STORE_OF_VALUE") {
    if (form.marketRegion === "BRAZIL")
      return { provider: "BRAPI", kind: "ETF" };
    if (form.marketRegion === "INTERNATIONAL")
      return { provider: "YAHOO", kind: "ETF" };
    return null;
  }
  const internationalClass = ["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(form.investmentClass);
  if (form.instrumentType === "ETF") {
    return internationalClass
      ? { provider: "YAHOO", kind: "ETF" }
      : { provider: "BRAPI", kind: "ETF" };
  }
  if (form.instrumentType === "STOCK" && form.investmentClass === "BRAZILIAN_STOCKS") {
    return { provider: "BRAPI", kind: "BRAZILIAN_STOCKS" };
  }
  if (form.instrumentType === "REAL_ESTATE_FUND" && form.investmentClass === "REAL_ESTATE_FUNDS") {
    return { provider: "BRAPI", kind: "REAL_ESTATE_FUNDS" };
  }
  if (form.instrumentType === "STOCK" && form.investmentClass === "INTERNATIONAL_STOCKS") {
    return { provider: "YAHOO", kind: "INTERNATIONAL_STOCKS" };
  }
  if (form.instrumentType === "REIT" && form.investmentClass === "REITS") {
    return { provider: "YAHOO", kind: "REITS" };
  }
  if (form.instrumentType === "CRYPTO" && form.investmentClass === "CRYPTO") {
    return { provider: "BINANCE", kind: "CRYPTO" };
  }
  return null;
}
export function questionTypeForClass(investmentClass: InvestmentClassKey) {
  if (["BRAZILIAN_STOCKS", "INTERNATIONAL_STOCKS"].includes(investmentClass))
    return "CERRADO" as const;
  if (["REAL_ESTATE_FUNDS", "REITS"].includes(investmentClass))
    return "REAL_ESTATE" as const;
  return null;
}
export type AssetsPanelProps = {
  assets: AssetDto[];
  fixedIncomeFamilies: PortfolioDto["fixedIncomeFamilies"];
  catalog: PortfolioDto["catalog"];
  integrationReview: PortfolioDto["integrationReview"];
  questions: DiagramQuestionDto[];
  initialAnswers: {
    assetId: string;
    questionId: string;
    answer: boolean;
  }[];
  timeZone: string;
  snapshotRevision: string;
};
