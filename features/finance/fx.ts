import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchYahooHistoricalFxRates } from "@/features/portfolio/yahoo-finance";
export { resolveTransactionFx } from "./fx-resolution";

const MAX_PREVIOUS_RATE_DAYS = 7;

function dateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number) {
  const result = dateOnly(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dayKey(value: Date) {
  return dateOnly(value).toISOString().slice(0, 10);
}

function nearestPreviousRate(
  date: Date,
  rates: Array<{ rateDate: Date; rateToBrl: Prisma.Decimal }>,
) {
  const target = dateOnly(date).getTime();
  return rates
    .filter((rate) => {
      const difference = target - dateOnly(rate.rateDate).getTime();
      return difference >= 0 && difference <= MAX_PREVIOUS_RATE_DAYS * 24 * 60 * 60_000;
    })
    .sort((left, right) => right.rateDate.getTime() - left.rateDate.getTime())[0] ?? null;
}

export async function ensureHistoricalFxRates(
  currency: string,
  dates: Date[],
  signal?: AbortSignal,
) {
  const normalizedCurrency = currency.trim().toUpperCase();
  const uniqueDates = [...new Map(dates.map((date) => [dayKey(date), dateOnly(date)])).values()];
  if (!uniqueDates.length) return new Map<string, { rateDate: Date; rateToBrl: Prisma.Decimal }>();
  if (normalizedCurrency === "BRL") {
    return new Map(uniqueDates.map((date) => [dayKey(date), {
      rateDate: date,
      rateToBrl: new Prisma.Decimal(1),
    }]));
  }
  const first = uniqueDates.reduce((minimum, date) => date < minimum ? date : minimum);
  const last = uniqueDates.reduce((maximum, date) => date > maximum ? date : maximum);
  let stored = await prisma.historicalFxRate.findMany({
    where: {
      currency: normalizedCurrency,
      source: "YAHOO",
      rateDate: {
        gte: addUtcDays(first, -MAX_PREVIOUS_RATE_DAYS),
        lte: last,
      },
    },
    orderBy: { rateDate: "asc" },
    select: { rateDate: true, rateToBrl: true },
  });
  const missing = uniqueDates.some((date) => !nearestPreviousRate(date, stored));
  if (missing) {
    const fetched = await fetchYahooHistoricalFxRates({
      currency: normalizedCurrency,
      period1: addUtcDays(first, -MAX_PREVIOUS_RATE_DAYS),
      period2: addUtcDays(last, 1),
      signal,
    }).catch(() => []);
    if (fetched.length) {
      await prisma.$transaction(
        fetched.map((rate) => prisma.historicalFxRate.upsert({
          where: {
            currency_rateDate_source: {
              currency: normalizedCurrency,
              rateDate: rate.rateDate,
              source: "YAHOO",
            },
          },
          update: {
            rateToBrl: rate.rateToBrl,
            fetchedAt: new Date(),
          },
          create: {
            currency: normalizedCurrency,
            rateDate: rate.rateDate,
            rateToBrl: rate.rateToBrl,
            source: "YAHOO",
          },
        })),
      );
      stored = await prisma.historicalFxRate.findMany({
        where: {
          currency: normalizedCurrency,
          source: "YAHOO",
          rateDate: {
            gte: addUtcDays(first, -MAX_PREVIOUS_RATE_DAYS),
            lte: last,
          },
        },
        orderBy: { rateDate: "asc" },
        select: { rateDate: true, rateToBrl: true },
      });
    }
  }
  return new Map(uniqueDates.flatMap((date) => {
    const rate = nearestPreviousRate(date, stored);
    return rate ? [[dayKey(date), rate] as const] : [];
  }));
}
