import type { Prisma } from "@prisma/client";

type MarketQuoteHolding = {
  pricingSource: string;
  unitPrice: Prisma.Decimal;
  priceUpdatedAt: Date | null;
};

function quoteTimestamp(holding: MarketQuoteHolding) {
  const timestamp = holding.priceUpdatedAt?.getTime();
  return timestamp != null && Number.isFinite(timestamp) ? timestamp : -Infinity;
}

export function selectLatestPluggyMarketQuote<T extends MarketQuoteHolding>(
  candidates: Array<T | null | undefined>,
): T | null {
  let latest: T | null = null;
  for (const candidate of candidates) {
    if (!candidate
      || !["BRAPI", "YAHOO"].includes(candidate.pricingSource)
      || !candidate.unitPrice.isFinite()
      || !candidate.unitPrice.gt(0)) continue;
    if (!latest || quoteTimestamp(candidate) > quoteTimestamp(latest)) latest = candidate;
  }
  return latest;
}
