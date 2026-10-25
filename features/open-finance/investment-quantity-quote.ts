import { Prisma, type PricingSource } from "@prisma/client";
import { fetchBrapiQuotes, normalizeBrapiSymbol, readCachedBrapiQuotes } from "@/features/portfolio/brapi";
import { requireBrapiCredentials } from "@/features/portfolio/brapi-credentials";
import {
  fetchYahooFxRates,
  fetchYahooQuotes,
  normalizeYahooSymbol,
  readCachedYahooQuotes,
} from "@/features/portfolio/yahoo-finance";
import { selectLatestPluggyMarketQuote } from "./market-quote";

type QuoteHolding = {
  pricingSource: PricingSource;
  unitPrice: Prisma.Decimal;
  currency: string;
  fxRateToBrl: Prisma.Decimal | null;
  fxUpdatedAt: Date | null;
  priceUpdatedAt: Date | null;
};

export type PluggyQuantityQuote = Pick<QuoteHolding,
  "pricingSource" | "unitPrice" | "currency" | "fxRateToBrl" | "fxUpdatedAt" | "priceUpdatedAt"
>;

function validDate(value: Date | null) {
  return value != null && Number.isFinite(value.getTime()) && value.getTime() > 0;
}

export function storedPluggyQuantityQuote(candidates: Array<QuoteHolding | null>) {
  return selectLatestPluggyMarketQuote(candidates.filter((candidate) =>
    candidate != null
    && validDate(candidate.priceUpdatedAt)
    && /^[A-Z]{3}$/.test(candidate.currency),
  ));
}

export function hasPluggyQuantityQuoteFx(quote: PluggyQuantityQuote) {
  return quote.currency === "BRL"
    || (quote.fxRateToBrl?.isFinite() === true && quote.fxRateToBrl.gt(0));
}

/** Price-only recovery for an owned position; never searches metadata or logos. */
export async function resolvePluggyQuantityQuote({
  userId,
  ticker,
  holding,
  manualHoldings,
  signal,
}: {
  userId: string;
  ticker: string;
  holding: QuoteHolding;
  manualHoldings: QuoteHolding[];
  signal?: AbortSignal;
}): Promise<PluggyQuantityQuote> {
  let quote: PluggyQuantityQuote | null = storedPluggyQuantityQuote([holding, ...manualHoldings]);
  if (!quote) {
    const pricingSource = holding.pricingSource;
    const normalize = pricingSource === "YAHOO" ? normalizeYahooSymbol : normalizeBrapiSymbol;
    const symbol = normalize(ticker);
    if (!symbol || !["BRAPI", "YAHOO"].includes(pricingSource)) {
      throw new Error("Este investimento não possui um identificador de cotação de mercado suportado.");
    }
    type PublicQuote = {
      requestedSymbol: string; price: number; currency: string; asOf: Date;
    };
    const usable = (value: PublicQuote | null | undefined): value is PublicQuote =>
      value != null
      && normalize(value.requestedSymbol) === symbol
      && Number.isFinite(value.price)
      && value.price > 0
      && /^[A-Z]{3}$/.test(value.currency)
      && validDate(value.asOf);
    let resolved: PublicQuote | null = null;
    if (pricingSource === "BRAPI") {
      // Shared quotes follow the same individual-key requirement as manual refresh.
      const { apiKey, plan } = await requireBrapiCredentials(userId);
      const cached = await readCachedBrapiQuotes([symbol]).catch(() => new Map());
      const hit = cached.get(symbol)?.quote;
      if (usable(hit)) resolved = hit;
      if (!resolved) {
        const fetched = await fetchBrapiQuotes({ apiKey, plan, tickers: [symbol], signal }).catch(() => []);
        resolved = fetched.find(usable) ?? null;
      }
    } else {
      const cached = await readCachedYahooQuotes([symbol]).catch(() => new Map());
      const hit = cached.get(symbol)?.quote;
      if (usable(hit)) resolved = hit;
      if (!resolved) {
        const fetched = await fetchYahooQuotes({ symbols: [symbol], signal }).catch(() => []);
        resolved = fetched.find(usable) ?? null;
      }
    }
    if (!resolved) {
      throw new Error(`Não foi possível obter uma cotação válida para ${symbol}. Tente novamente quando o provedor estiver disponível.`);
    }
    quote = {
      pricingSource,
      unitPrice: new Prisma.Decimal(resolved.price),
      currency: resolved.currency,
      fxRateToBrl: resolved.currency === holding.currency ? holding.fxRateToBrl : null,
      fxUpdatedAt: resolved.currency === holding.currency ? holding.fxUpdatedAt : null,
      priceUpdatedAt: resolved.asOf,
    };
  }
  if (quote.currency === "BRL") return { ...quote, fxRateToBrl: null, fxUpdatedAt: null };
  if (hasPluggyQuantityQuoteFx(quote)) return quote;
  if (holding.currency === quote.currency && holding.fxRateToBrl?.isFinite() && holding.fxRateToBrl.gt(0)) {
    return { ...quote, fxRateToBrl: holding.fxRateToBrl, fxUpdatedAt: holding.fxUpdatedAt };
  }
  const currency = quote.currency;
  const rates = await fetchYahooFxRates({ currencies: [currency], signal }).catch(() => []);
  const rate = rates.find((entry) =>
    entry.currency === currency
    && Number.isFinite(entry.rateToBrl)
    && entry.rateToBrl > 0
    && validDate(entry.asOf),
  );
  if (!rate) throw new Error(`Não foi possível obter um câmbio válido de ${currency} para BRL. Tente novamente quando o provedor estiver disponível.`);
  return { ...quote, fxRateToBrl: new Prisma.Decimal(rate.rateToBrl), fxUpdatedAt: rate.asOf };
}
