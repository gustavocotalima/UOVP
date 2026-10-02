import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  market: vi.fn(),
  accounts: vi.fn(),
  pluggy: vi.fn(),
  binance: vi.fn(),
  getActiveUser: vi.fn(),
  isSameOriginRequest: vi.fn(),
  revalidatePath: vi.fn(),
  logIntegrationRefresh: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/features/portfolio/actions", () => ({ refreshStaleMarketPricesAction: mocks.market }));
vi.mock("@/features/finance/account-fx", () => ({ refreshStaleFinancialAccountFx: mocks.accounts }));
vi.mock("@/features/open-finance/automatic-sync", () => ({ syncStalePluggyItemsForUser: mocks.pluggy }));
vi.mock("@/features/portfolio/binance-wallet-sync", () => ({ syncStaleBinanceWalletForUser: mocks.binance }));
vi.mock("@/lib/current-user", () => ({ getActiveUser: mocks.getActiveUser }));
vi.mock("@/lib/request-security", () => ({ isSameOriginRequest: mocks.isSameOriginRequest }));
vi.mock("@/lib/operation-security", () => ({ OperationInProgressError: class extends Error {} }));
vi.mock("@/lib/integration-observability", () => ({
  anonymizedUserId: () => "anonymous-user",
  logIntegrationRefresh: mocks.logIntegrationRefresh,
}));

import { POST } from "@/app/api/bootstrap-refresh/route";
import type { BootstrapRefreshIntegrationResult, BootstrapRefreshResponse } from "@/lib/bootstrap-refresh";

const skipped: BootstrapRefreshIntegrationResult = { status: "SKIPPED", changed: false, message: null };
const updated: BootstrapRefreshIntegrationResult = { status: "UPDATED", changed: true, message: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function request() {
  return new Request("http://localhost/api/bootstrap-refresh", { method: "POST" });
}

describe("ordem do bootstrap autenticado", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getActiveUser.mockResolvedValue({ id: "user-a" });
    mocks.isSameOriginRequest.mockReturnValue(true);
    mocks.market.mockResolvedValue(skipped);
    mocks.accounts.mockResolvedValue(skipped);
    mocks.pluggy.mockResolvedValue({
      ...skipped,
      reason: null,
      requestedConnections: 0,
      updatedConnections: 0,
      failedConnections: 0,
    });
    mocks.binance.mockResolvedValue({
      ...skipped,
      reason: null,
      discovered: 0,
      tracked: 0,
      failedWallets: [],
    });
  });

  it("aguarda Pluggy e Binance antes das cotações, mantendo o câmbio independente", async () => {
    const pluggy = deferred<BootstrapRefreshIntegrationResult>();
    const binance = deferred<BootstrapRefreshIntegrationResult>();
    const accounts = deferred<BootstrapRefreshIntegrationResult>();
    mocks.pluggy.mockReturnValue(pluggy.promise);
    mocks.binance.mockReturnValue(binance.promise);
    mocks.accounts.mockReturnValue(accounts.promise);

    const responsePromise = POST(request());
    await vi.waitFor(() => {
      expect(mocks.pluggy).toHaveBeenCalledWith("user-a");
      expect(mocks.binance).toHaveBeenCalledWith("user-a");
      expect(mocks.accounts).toHaveBeenCalledWith("user-a");
    });
    expect(mocks.market).not.toHaveBeenCalled();

    pluggy.resolve(updated);
    await pluggy.promise;
    expect(mocks.market).not.toHaveBeenCalled();

    binance.resolve(updated);
    await vi.waitFor(() => expect(mocks.market).toHaveBeenCalledTimes(1));
    // The market check does not wait for the unrelated account-FX request.
    accounts.resolve(skipped);
    const response = await responsePromise;
    const body = await response.json() as BootstrapRefreshResponse;
    expect(body.pluggy).toEqual(updated);
    expect(body.binanceWallet).toEqual(updated);
    expect(body.accounts).toEqual(skipped);
  });

  it("mantém a cotação de mercado como última escrita após o snapshot Pluggy", async () => {
    const snapshot = deferred<BootstrapRefreshIntegrationResult>();
    let price = 10;
    mocks.pluggy.mockImplementation(async () => {
      const result = await snapshot.promise;
      price = 11;
      return result;
    });
    mocks.market.mockImplementation(async () => {
      expect(price).toBe(11);
      price = 20;
      return updated;
    });

    const responsePromise = POST(request());
    await vi.waitFor(() => expect(mocks.pluggy).toHaveBeenCalledTimes(1));
    snapshot.resolve(updated);
    const response = await responsePromise;

    expect(price).toBe(20);
    expect((await response.json()).market).toEqual(updated);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/carteira");
  });

  it("executa as cotações mesmo se as sincronizações dos provedores falharem", async () => {
    mocks.pluggy.mockRejectedValue(new Error("Pluggy indisponível"));
    mocks.binance.mockRejectedValue(new Error("Binance indisponível"));
    mocks.market.mockResolvedValue(updated);

    const response = await POST(request());
    const body = await response.json() as BootstrapRefreshResponse;

    expect(mocks.market).toHaveBeenCalledTimes(1);
    expect(body.market).toEqual(updated);
    expect(body.pluggy.status).toBe("FAILED");
    expect(body.binanceWallet.status).toBe("FAILED");
    expect(body.accounts.status).toBe("SKIPPED");
  });

  it("preserva o resultado parcial da Pluggy sem impedir as cotações", async () => {
    const partial: BootstrapRefreshIntegrationResult = {
      status: "PARTIAL", changed: true, message: "Uma conexão falhou.",
    };
    mocks.pluggy.mockResolvedValue(partial);

    const response = await POST(request());
    const body = await response.json() as BootstrapRefreshResponse;

    expect(mocks.market).toHaveBeenCalledTimes(1);
    expect(body.pluggy).toEqual(partial);
    expect(body.market).toEqual(skipped);
  });

  it("preserva os resultados dos provedores se a etapa de mercado falhar", async () => {
    mocks.pluggy.mockResolvedValue(updated);
    mocks.market.mockRejectedValue(new Error("Mercado indisponível"));

    const response = await POST(request());
    const body = await response.json() as BootstrapRefreshResponse;

    expect(body.pluggy).toEqual(updated);
    expect(body.market).toEqual({ status: "FAILED", changed: false, message: "Mercado indisponível" });
  });

  it("não inicia integrações para requisições não autenticadas ou de outra origem", async () => {
    mocks.isSameOriginRequest.mockReturnValueOnce(false);
    expect((await POST(request())).status).toBe(403);
    mocks.getActiveUser.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);

    expect(mocks.market).not.toHaveBeenCalled();
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.pluggy).not.toHaveBeenCalled();
    expect(mocks.binance).not.toHaveBeenCalled();
  });
});
