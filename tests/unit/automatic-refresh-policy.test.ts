import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_REFRESH_STALE_MS,
  isAutomaticRefreshStale,
  shouldRefreshMarketHoldings,
  shouldSyncPluggyItems,
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

  it("sincroniza todas as conexões se uma estiver pendente, ausente ou vencida", () => {
    const recent = new Date(now.getTime() - 60_000);
    expect(shouldSyncPluggyItems([
      { syncPending: false, lastSyncAt: recent },
      { syncPending: true, lastSyncAt: recent },
    ], now)).toBe(true);
    expect(shouldSyncPluggyItems([
      { syncPending: false, lastSyncAt: null },
    ], now)).toBe(true);
    expect(shouldSyncPluggyItems([
      { syncPending: false, lastSyncAt: new Date(now.getTime() - AUTOMATIC_REFRESH_STALE_MS) },
    ], now)).toBe(true);
  });

  it("não sincroniza Pluggy recente e sem pendências", () => {
    expect(shouldSyncPluggyItems([
      { syncPending: false, lastSyncAt: new Date(now.getTime() - 60_000) },
    ], now)).toBe(false);
    expect(shouldSyncPluggyItems([], now)).toBe(false);
  });

  it("trata timestamps inválidos como vencidos", () => {
    expect(isAutomaticRefreshStale("inválido", now)).toBe(true);
  });
});
