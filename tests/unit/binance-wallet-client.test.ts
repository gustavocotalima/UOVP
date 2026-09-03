import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { binanceDiscoveryStatus } from "@/features/portfolio/binance-wallet-sync";
import {
  BinancePrivateClient,
  encodeBinanceSignedParameters,
} from "@/features/portfolio/binance-wallet-client";

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const credentials = { apiKey: "test-api-key", apiSecret: "test-api-secret" };

describe("cliente privado da Binance", () => {
  it("mantém a escolha do usuário e exige revisão quando surge conflito manual", () => {
    expect(binanceDiscoveryStatus(null, false)).toBe("AVAILABLE");
    expect(binanceDiscoveryStatus("AVAILABLE", true)).toBe("NEEDS_REVIEW");
    expect(binanceDiscoveryStatus("NEEDS_REVIEW", false)).toBe("AVAILABLE");
    expect(binanceDiscoveryStatus("TRACKED", true)).toBe("TRACKED");
    expect(binanceDiscoveryStatus("IGNORED", true)).toBe("IGNORED");
  });
  it("codifica parâmetros conforme RFC 3986", () => {
    expect(encodeBinanceSignedParameters({ memo: "a b+c/!", timestamp: 1 }))
      .toBe("memo=a%20b%2Bc%2F%21&timestamp=1");
  });

  it("assina USER_DATA sem expor o segredo", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v3/time")) return json({ serverTime: Date.now() });
      expect(init?.headers).toMatchObject({ "X-MBX-APIKEY": credentials.apiKey });
      const query = url.split("?")[1];
      const [unsigned, signature] = query.split("&signature=");
      expect(signature).toBe(createHmac("sha256", credentials.apiSecret).update(unsigned).digest("hex"));
      expect(url).not.toContain(credentials.apiSecret);
      return json({
        ipRestrict: true,
        enableReading: true,
        enableWithdrawals: false,
        enableSpotAndMarginTrading: false,
      });
    });
    const permissions = await new BinancePrivateClient(credentials, fetcher).permissions();
    expect(permissions).toEqual({
      ipRestricted: true,
      readEnabled: true,
      tradingEnabled: false,
      withdrawalsEnabled: false,
      warning: false,
    });
  });

  it("recalcula o relógio e tenta uma vez novamente para -1021", async () => {
    let permissionCalls = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/v3/time")) return json({ serverTime: Date.now() });
      permissionCalls += 1;
      if (permissionCalls === 1) return json({ code: -1021, msg: "outside recvWindow" }, 400);
      return json({ enableReading: true, enableWithdrawals: true });
    });
    const permissions = await new BinancePrivateClient(credentials, fetcher).permissions();
    expect(permissionCalls).toBe(2);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("/api/v3/time"))).toHaveLength(2);
    expect(permissions.warning).toBe(true);
  });

  it("mantém Spot, Funding e os dois tipos de Earn separados", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/v3/time")) return json({ serverTime: Date.now() });
      if (url.includes("/sapi/v1/asset/wallet/balance")) {
        return json([
          { walletName: "Spot", assetBalances: [{ asset: "BTC", assetName: "Bitcoin", free: "0.5", locked: "0.1", freeze: "0", withdrawing: "0", btcValuation: "0.6" }] },
          { walletName: "Funding", assetBalances: [{ asset: "ETH", free: "2", locked: "0", freeze: "0", withdrawing: "0", btcValuation: "0.05" }] },
        ]);
      }
      if (url.includes("/simple-earn/flexible/position")) return json({ rows: [{ asset: "BTC", totalAmount: "0.4" }], total: 1 });
      if (url.includes("/simple-earn/locked/position")) return json({ rows: [{ asset: "BTC", amount: "0.2" }], total: 1 });
      throw new Error(`unexpected ${url}`);
    });
    const snapshot = await new BinancePrivateClient(credentials, fetcher).walletSnapshot();
    expect(snapshot.totalBtcValuations).toEqual({ BTC: "0.6", ETH: "0.05" });
    expect(snapshot.valuationsComplete).toBe(true);
    expect(snapshot.buckets).toEqual([
      expect.objectContaining({ kind: "SPOT", ok: true, balances: [expect.objectContaining({ symbol: "BTC", quantity: "0.6" })] }),
      expect.objectContaining({ kind: "FUNDING", ok: true, balances: [expect.objectContaining({ symbol: "ETH", quantity: "2" })] }),
      expect.objectContaining({ kind: "EARN_FLEXIBLE", ok: true, balances: [expect.objectContaining({ symbol: "BTC", quantity: "0.4" })] }),
      expect.objectContaining({ kind: "EARN_LOCKED", ok: true, balances: [expect.objectContaining({ symbol: "BTC", quantity: "0.2" })] }),
    ]);
  });

  it("retorna sincronização parcial sem apagar as carteiras bem-sucedidas", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/v3/time")) return json({ serverTime: Date.now() });
      if (url.includes("/sapi/v1/asset/wallet/balance")) return json([{ walletName: "Spot", assetBalances: [] }, { walletName: "Funding", assetBalances: [] }]);
      if (url.includes("/simple-earn/flexible/position")) return json({ code: -1000 }, 500);
      if (url.includes("/simple-earn/locked/position")) return json({ rows: [], total: 0 });
      throw new Error(`unexpected ${url}`);
    });
    const snapshot = await new BinancePrivateClient(credentials, fetcher).walletSnapshot();
    expect(snapshot.buckets.find((bucket) => bucket.kind === "SPOT")?.ok).toBe(true);
    expect(snapshot.buckets.find((bucket) => bucket.kind === "EARN_FLEXIBLE")?.ok).toBe(false);
    expect(snapshot.buckets.find((bucket) => bucket.kind === "EARN_LOCKED")?.ok).toBe(true);
  });
});
