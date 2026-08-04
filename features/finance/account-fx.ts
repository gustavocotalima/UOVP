import "server-only";

import { Prisma } from "@prisma/client";
import { ensureHistoricalFxRates } from "@/features/finance/fx";
import {
  fetchYahooFxRates,
  readCachedYahooQuotes,
  yahooFxSymbol,
} from "@/features/portfolio/yahoo-finance";
import { prisma } from "@/lib/prisma";
import {
  withUserOperationLease,
  type UserOperationLeaseContext,
} from "@/lib/operation-security";
import {
  accountBalanceBrl,
  isAccountFxFresh,
  sameFinancialDate,
  type FinancialAccountCurrency,
} from "./account-currency";

export type ResolvedFinancialFx = {
  rateToBrl: Prisma.Decimal;
  rateDate: Date;
  source: "NATIVE" | "YAHOO" | "MANUAL";
  fetchedAt: Date;
};

export type FinancialFxRequiredResult = {
  ok: false;
  code: "FX_RATE_REQUIRED";
  currencyCode: "USD";
  rateDate: string;
  message: string;
};

export type FinancialMutationSuccess = { ok: true };
export type FinancialMutationResult = FinancialMutationSuccess | FinancialFxRequiredResult;

export function financialFxRequired(rateDate: Date): FinancialFxRequiredResult {
  return {
    ok: false,
    code: "FX_RATE_REQUIRED",
    currencyCode: "USD",
    rateDate: rateDate.toISOString().slice(0, 10),
    message: "Não foi possível obter a cotação USD/BRL. Informe a cotação manual para continuar.",
  };
}

function manualFx(rateToBrl: number, rateDate: Date): ResolvedFinancialFx {
  return {
    rateToBrl: new Prisma.Decimal(rateToBrl),
    rateDate,
    source: "MANUAL",
    fetchedAt: new Date(),
  };
}

export async function resolveCurrentFinancialFx(input: {
  currencyCode: FinancialAccountCurrency;
  manualRateToBrl?: number;
  existing?: {
    rateToBrl: Prisma.Decimal | null;
    rateDate: Date | null;
    source: "NATIVE" | "PLUGGY" | "YAHOO" | "MANUAL" | null;
    fetchedAt: Date | null;
  } | null;
  now?: Date;
  signal?: AbortSignal;
}): Promise<ResolvedFinancialFx | null> {
  const now = input.now ?? new Date();
  if (input.currencyCode === "BRL") {
    return { rateToBrl: new Prisma.Decimal(1), rateDate: now, source: "NATIVE", fetchedAt: now };
  }
  if (input.manualRateToBrl !== undefined) return manualFx(input.manualRateToBrl, now);

  const symbol = yahooFxSymbol(input.currencyCode);
  if (symbol) {
    const cached = (await readCachedYahooQuotes([symbol])).get(symbol);
    if (cached && isAccountFxFresh(cached.cachedAt, now)) {
      return {
        rateToBrl: new Prisma.Decimal(cached.quote.price),
        rateDate: cached.quote.asOf,
        source: "YAHOO",
        fetchedAt: cached.cachedAt,
      };
    }
  }

  const [rate] = await fetchYahooFxRates({
    currencies: [input.currencyCode],
    cacheMode: "REFRESH",
    signal: input.signal,
  }).catch(() => []);
  if (rate) {
    return {
      rateToBrl: new Prisma.Decimal(rate.rateToBrl),
      rateDate: rate.asOf,
      source: "YAHOO",
      fetchedAt: now,
    };
  }

  if (
    input.existing?.rateToBrl
    && input.existing.rateDate
    && isAccountFxFresh(input.existing.fetchedAt, now)
  ) {
    return {
      rateToBrl: input.existing.rateToBrl,
      rateDate: input.existing.rateDate,
      source: input.existing.source === "MANUAL" ? "MANUAL" : "YAHOO",
      fetchedAt: input.existing.fetchedAt!,
    };
  }
  return null;
}

export async function resolveHistoricalFinancialFx(input: {
  currencyCode: FinancialAccountCurrency;
  transactionDate: Date;
  manualRateToBrl?: number;
  existing?: {
    currencyCode: string;
    rateToBrl: Prisma.Decimal | null;
    rateDate: Date | null;
    source: "NATIVE" | "PLUGGY" | "YAHOO" | "MANUAL" | null;
  } | null;
}): Promise<ResolvedFinancialFx | null> {
  if (input.currencyCode === "BRL") {
    return {
      rateToBrl: new Prisma.Decimal(1),
      rateDate: input.transactionDate,
      source: "NATIVE",
      fetchedAt: input.transactionDate,
    };
  }
  if (input.manualRateToBrl !== undefined) {
    return manualFx(input.manualRateToBrl, input.transactionDate);
  }
  if (
    input.existing?.currencyCode === input.currencyCode
    && input.existing.rateToBrl
    && input.existing.rateDate
    && sameFinancialDate(input.existing.rateDate, input.transactionDate)
  ) {
    return {
      rateToBrl: input.existing.rateToBrl,
      rateDate: input.existing.rateDate,
      source: input.existing.source === "MANUAL" ? "MANUAL" : "YAHOO",
      fetchedAt: input.existing.rateDate,
    };
  }
  const rates = await ensureHistoricalFxRates(input.currencyCode, [input.transactionDate]);
  const rate = rates.get(input.transactionDate.toISOString().slice(0, 10));
  return rate
    ? { rateToBrl: rate.rateToBrl, rateDate: rate.rateDate, source: "YAHOO", fetchedAt: new Date() }
    : null;
}

async function refreshStaleFinancialAccountFxWithLease(
  userId: string,
  lease: UserOperationLeaseContext,
) {
  const now = new Date();
  const accounts = await prisma.financialAccount.findMany({
    where: { userId, active: true, source: "MANUAL", currencyCode: "USD" },
    select: { id: true, balance: true, providerUpdatedAt: true },
  });
  if (!accounts.length || accounts.every((account) => isAccountFxFresh(account.providerUpdatedAt, now))) {
    return { status: "SKIPPED" as const, changed: false, message: null };
  }
  const fx = await resolveCurrentFinancialFx({ currencyCode: "USD", now, signal: lease.signal });
  if (!fx) {
    return {
      status: "FAILED" as const,
      changed: false,
      message: "Não foi possível atualizar a cotação USD/BRL das contas.",
    };
  }
  await lease.runFencedTransaction(async (tx) => {
    for (const account of accounts) {
      await tx.financialAccount.update({
        where: { id: account.id },
        data: {
          balanceBrl: accountBalanceBrl(account.balance, fx.rateToBrl).toString(),
          balanceFxRateToBrl: fx.rateToBrl,
          balanceFxRateDate: fx.rateDate,
          balanceFxSource: fx.source,
          providerUpdatedAt: fx.fetchedAt,
        },
      });
    }
  });
  return { status: "UPDATED" as const, changed: true, message: null };
}

export async function refreshStaleFinancialAccountFx(userId: string) {
  return withUserOperationLease({
    userId,
    operation: "financial-account-fx-refresh",
    leaseMs: 60_000,
    action: (lease) => refreshStaleFinancialAccountFxWithLease(userId, lease),
  });
}
