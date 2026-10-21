import { describe, expect, it } from "vitest";
import { selectBinanceWalletSnapshot } from "@/features/settings/binance-wallet-snapshot";
import type { BinanceConnectionStatus } from "@/features/portfolio/binance-wallet-credentials";

function status(revision: string, configured = true): BinanceConnectionStatus {
  return {
    snapshotRevision: revision, configured, apiKeyLastFour: configured ? "1234" : null, updatedAt: null, status: configured ? "CONNECTED" : null,
    ipRestricted: true, readEnabled: configured, tradingEnabled: false, withdrawalsEnabled: false, permissionWarning: false,
    lastAttemptAt: null, lastSyncAt: null, syncPending: false, lastError: null, assets: [],
  };
}

describe("ordenação dos snapshots do card Binance", () => {
  it("refresh de props prevalece sobre uma resposta antiga da ação pendente", () => {
    const initial = { status: status("100"), requestId: 0 };
    const refreshed = selectBinanceWalletSnapshot(initial, { status: status("300"), requestId: 2 });
    expect(selectBinanceWalletSnapshot(refreshed, { status: status("200"), requestId: 1 })).toBe(refreshed);
  });

  it("aceita resultado da ação iniciado antes do refresh quando o snapshot é posterior", () => {
    const refreshed = { status: status("300"), requestId: 2 };
    const completed = { status: status("400"), requestId: 1 };
    expect(selectBinanceWalletSnapshot(refreshed, completed)).toBe(completed);
  });

  it("desempata revisões iguais pela ordem local dos pedidos", () => {
    const current = { status: status("300"), requestId: 3 };
    expect(selectBinanceWalletSnapshot(current, { status: status("300"), requestId: 2 })).toBe(current);
    const newer = { status: status("300"), requestId: 4 };
    expect(selectBinanceWalletSnapshot(current, newer)).toBe(newer);
  });

  it("não ressuscita conexão removida com uma resposta antiga", () => {
    const removed = { status: status("500", false), requestId: 2 };
    expect(selectBinanceWalletSnapshot(removed, { status: status("490"), requestId: 1 })).toBe(removed);
  });
});
