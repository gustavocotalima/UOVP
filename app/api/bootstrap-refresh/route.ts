import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { refreshStaleMarketPricesAction } from "@/features/portfolio/actions";
import { refreshStaleFinancialAccountFx } from "@/features/finance/account-fx";
import { syncStalePluggyItemsForUser } from "@/features/open-finance/automatic-sync";
import { syncStaleBinanceWalletForUser } from "@/features/portfolio/binance-wallet-sync";
import { getActiveUser } from "@/lib/current-user";
import { OperationInProgressError } from "@/lib/operation-security";
import { isSameOriginRequest } from "@/lib/request-security";
import type {
  BootstrapRefreshIntegrationResult,
  BootstrapRefreshResponse,
} from "@/lib/bootstrap-refresh";
import { anonymizedUserId, logIntegrationRefresh } from "@/lib/integration-observability";

export const maxDuration = 300;

function failedResult(error: unknown): BootstrapRefreshIntegrationResult {
  if (error instanceof OperationInProgressError) {
    return { status: "SKIPPED", changed: false, message: null };
  }
  return {
    status: "FAILED",
    changed: false,
    message: error instanceof Error ? error.message : "Não foi possível atualizar os dados.",
  };
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  const user = await getActiveUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });

  const startedAt = Date.now();
  const [marketSettled, accountsSettled, pluggySettled, binanceSettled] = await Promise.allSettled([
    refreshStaleMarketPricesAction(),
    refreshStaleFinancialAccountFx(user.id),
    syncStalePluggyItemsForUser(user.id),
    syncStaleBinanceWalletForUser(user.id),
  ]);
  const market = marketSettled.status === "fulfilled"
    ? {
        status: marketSettled.value.status,
        changed: marketSettled.value.changed,
        message: marketSettled.value.message,
      }
    : failedResult(marketSettled.reason);
  const pluggy = pluggySettled.status === "fulfilled"
    ? {
        status: pluggySettled.value.status,
        changed: pluggySettled.value.changed,
        message: pluggySettled.value.message,
      }
    : failedResult(pluggySettled.reason);
  const accounts = accountsSettled.status === "fulfilled"
    ? accountsSettled.value
    : failedResult(accountsSettled.reason);
  const binanceWallet = binanceSettled.status === "fulfilled"
    ? { status: binanceSettled.value.status, changed: binanceSettled.value.changed, message: binanceSettled.value.message }
    : failedResult(binanceSettled.reason);
  const response: BootstrapRefreshResponse = { market, accounts, pluggy, binanceWallet };

  if (market.changed || accounts.changed || pluggy.changed || binanceWallet.changed) {
    [
      "/home",
      "/carteira",
      "/open-finance",
      "/orcamento-domestico",
      "/metas",
      "/contas",
      "/faturas",
      "/transacoes",
      "/tags",
    ].forEach((path) => revalidatePath(path));
  }

  logIntegrationRefresh({
    event: "authenticated-bootstrap-refresh",
    user: anonymizedUserId(user.id),
    durationMs: Date.now() - startedAt,
    market: {
      reason: "AUTOMATIC_STALE",
      status: market.status,
      changed: market.changed,
    },
    accounts: {
      reason: "AUTOMATIC_STALE",
      status: accounts.status,
      changed: accounts.changed,
    },
    pluggy: {
      reason: pluggySettled.status === "fulfilled" ? pluggySettled.value.reason : "AUTOMATIC_STALE",
      status: pluggy.status,
      changed: pluggy.changed,
      requestedConnections: pluggySettled.status === "fulfilled"
        ? pluggySettled.value.requestedConnections
        : undefined,
      updatedConnections: pluggySettled.status === "fulfilled"
        ? pluggySettled.value.updatedConnections
        : undefined,
      failedConnections: pluggySettled.status === "fulfilled"
        ? pluggySettled.value.failedConnections
        : undefined,
    },
    binanceWallet: {
      reason: binanceSettled.status === "fulfilled" ? binanceSettled.value.reason : "AUTOMATIC_STALE",
      status: binanceWallet.status,
      changed: binanceWallet.changed,
      discovered: binanceSettled.status === "fulfilled" ? binanceSettled.value.discovered : undefined,
      tracked: binanceSettled.status === "fulfilled" ? binanceSettled.value.tracked : undefined,
      failedWallets: binanceSettled.status === "fulfilled" ? binanceSettled.value.failedWallets : undefined,
    },
  });

  return NextResponse.json(response);
}
