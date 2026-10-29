import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_REFRESH_STALE_MS,
  isAutomaticRefreshStale,
  shouldRefreshMarketHoldings,
  selectPluggyItemsForAutomaticSync,
  shouldSyncBinanceConnection,
} from "@/lib/automatic-refresh-policy";

const now = new Date("2026-07-27T15:00:00.000Z");

describe("política de atualização automática", () => {
  it("mantém cotações recentes sem consultar provedores", () => {
    expect(shouldRefreshMarketHoldings([
      { priceUpdatedAt: new Date(now.getTime() - AUTOMATIC_REFRESH_STALE_MS + 1) },
      { priceUpdatedAt: new Date(now.getTime() - 60_000) },
    ], now)).toBe(false);
  });

  it("atualiza a carteira inteira quando uma cotação está ausente ou venceu", () => {
    expect(shouldRefreshMarketHoldings([
      { priceUpdatedAt: new Date(now.getTime() - 60_000) },
      { priceUpdatedAt: new Date(now.getTime() - AUTOMATIC_REFRESH_STALE_MS) },
    ], now)).toBe(true);
    expect(shouldRefreshMarketHoldings([{ priceUpdatedAt: null }], now)).toBe(true);
  });

  it("não executa atualização de mercado para uma carteira sem ativos elegíveis", () => {
    expect(shouldRefreshMarketHoldings([], now)).toBe(false);
  });

  it("identifica conexões pendentes, ausentes ou vencidas", () => {
    const recent = new Date(now.getTime() - 60_000);
    expect((selectPluggyItemsForAutomaticSync([
      { syncPending: false, lastSyncAt: recent },
      { syncPending: true, lastSyncAt: recent },
    ], now).length > 0)).toBe(true);
    expect((selectPluggyItemsForAutomaticSync([
      { syncPending: false, lastSyncAt: null },
    ], now).length > 0)).toBe(true);
    expect((selectPluggyItemsForAutomaticSync([
      { syncPending: false, lastSyncAt: new Date(now.getTime() - AUTOMATIC_REFRESH_STALE_MS) },
    ], now).length > 0)).toBe(true);
  });

  it("seleciona somente os itens pendentes ou vencidos em uma lista mista", () => {
    const items = [
      { id: "recent", syncPending: false, lastSyncAt: now },
      { id: "pending", syncPending: true, lastSyncAt: now },
      { id: "missing", syncPending: false, lastSyncAt: null },
      { id: "stale", syncPending: false, lastSyncAt: new Date(now.getTime() - AUTOMATIC_REFRESH_STALE_MS) },
      { id: "invalid", syncPending: false, lastSyncAt: "invalid" },
    ];
    expect(selectPluggyItemsForAutomaticSync(items, now).map((item) => item.id)).toEqual([
      "pending", "missing", "stale", "invalid",
    ]);
    expect(items).toHaveLength(5);
  });

  it("não sincroniza Pluggy recente e sem pendências", () => {
    expect((selectPluggyItemsForAutomaticSync([
      { syncPending: false, lastSyncAt: new Date(now.getTime() - 60_000) },
    ], now).length > 0)).toBe(false);
    expect((selectPluggyItemsForAutomaticSync([], now).length > 0)).toBe(false);
  });

  it("sincroniza a Binance somente quando a conexão está pendente ou vencida", () => {
    expect(shouldSyncBinanceConnection(null, now)).toBe(false);
    expect(shouldSyncBinanceConnection({ syncPending: false, lastSyncAt: new Date(now.getTime() - 60_000) }, now)).toBe(false);
    expect(shouldSyncBinanceConnection({ syncPending: true, lastSyncAt: now }, now)).toBe(true);
    expect(shouldSyncBinanceConnection({ syncPending: false, lastSyncAt: new Date(now.getTime() - AUTOMATIC_REFRESH_STALE_MS) }, now)).toBe(true);
  });

  it("trata timestamps inválidos como vencidos", () => {
    expect(isAutomaticRefreshStale("inválido", now)).toBe(true);
  });
});
