export type ContributionScopeKey = "ALL_ASSETS" | "BRL_ONLY" | "USD_ONLY";

type ContributionScopeAsset = {
  nativeCurrency: string | null;
  instrumentType: string;
  holdings: Array<{
    currency: string;
    pricingSource: string;
  }>;
};

export function defaultContributionScope(currency: "BRL" | "USD"): ContributionScopeKey {
  return currency === "USD" ? "USD_ONLY" : "ALL_ASSETS";
}

export function currencyOnlyContributionScope(currency: "BRL" | "USD"): ContributionScopeKey {
  return currency === "USD" ? "USD_ONLY" : "BRL_ONLY";
}

export function isContributionScopeValid(
  currency: "BRL" | "USD",
  scope: ContributionScopeKey,
) {
  return scope === "ALL_ASSETS" || scope === currencyOnlyContributionScope(currency);
}

export function assetCanReceiveContribution(
  asset: ContributionScopeAsset,
  scope: ContributionScopeKey,
) {
  if (scope === "ALL_ASSETS") return true;

  if (scope === "USD_ONLY") {
    return asset.nativeCurrency?.trim().toUpperCase() === "USD"
      && ["STOCK", "ETF", "REIT"].includes(asset.instrumentType)
      && asset.holdings.some((holding) => holding.pricingSource === "YAHOO");
  }

  return asset.nativeCurrency === null
    && asset.holdings.every((holding) => holding.currency.trim().toUpperCase() === "BRL");
}
