export const AUTOMATIC_REFRESH_STALE_MS = 12 * 60 * 60_000;
export const AUTOMATIC_REFRESH_BACKGROUND_MS = 15 * 60_000;

export function isAutomaticRefreshStale(
  value: Date | string | null | undefined,
  now = new Date(),
) {
  if (!value) return true;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return !Number.isFinite(timestamp)
    || now.getTime() - timestamp >= AUTOMATIC_REFRESH_STALE_MS;
}

export function shouldRefreshMarketHoldings(
  holdings: Array<{ priceUpdatedAt: Date | string | null }>,
  now = new Date(),
) {
  return holdings.length > 0
    && holdings.some((holding) => isAutomaticRefreshStale(holding.priceUpdatedAt, now));
}

export function shouldSyncPluggyItems(
  items: Array<{ syncPending: boolean; lastSyncAt: Date | string | null }>,
  now = new Date(),
) {
  return items.length > 0
    && items.some((item) => item.syncPending || isAutomaticRefreshStale(item.lastSyncAt, now));
}
