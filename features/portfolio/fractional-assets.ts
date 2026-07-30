import type { InstrumentType, InvestmentClass, PricingSource } from "@prisma/client";

type FractionalAssetInput = {
  instrumentType: InstrumentType | null;
  investmentClass: InvestmentClass | null;
  pricingSource?: PricingSource | null;
  fallback?: boolean;
};

const MARKET_INSTRUMENTS = new Set<InstrumentType>([
  "STOCK",
  "ETF",
  "REAL_ESTATE_FUND",
  "REIT",
]);

const INTERNATIONAL_MARKET_CLASSES = new Set<InvestmentClass>([
  "INTERNATIONAL_STOCKS",
  "REITS",
  "INTERNATIONAL_FIXED_INCOME",
]);

/**
 * Fractional trading is determined by the market, not only by the instrument.
 * Yahoo-backed securities are international and can be suggested fractionally;
 * equivalent B3 instruments remain restricted to whole units.
 */
export function allowsFractionalUnits({
  instrumentType,
  investmentClass,
  pricingSource,
  fallback = false,
}: FractionalAssetInput) {
  if (instrumentType === "FIXED_INCOME"
    || instrumentType === "CRYPTO"
    || instrumentType === "MUTUAL_FUND") {
    return true;
  }

  if (instrumentType === null || !MARKET_INSTRUMENTS.has(instrumentType)) return fallback;
  if (pricingSource === "YAHOO") return true;
  if (pricingSource === "BRAPI") return false;
  return (investmentClass !== null && INTERNATIONAL_MARKET_CLASSES.has(investmentClass)) || fallback;
}
