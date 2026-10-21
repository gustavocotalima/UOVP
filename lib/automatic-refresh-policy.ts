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

type PluggyRefreshState = { syncPending: boolean; lastSyncAt: Date | string | null };

export function selectPluggyItemsForAutomaticSync<T extends PluggyRefreshState>(
  items: readonly T[],
  now = new Date(),
): T[] {
  return items.filter((item) => item.syncPending || isAutomaticRefreshStale(item.lastSyncAt, now));
}

export function shouldSyncPluggyItems(
  items: readonly PluggyRefreshState[],
  now = new Date(),
) {
  return selectPluggyItemsForAutomaticSync(items, now).length > 0;
}

export function shouldSyncBinanceConnection(
  connection: { syncPending: boolean; lastSyncAt: Date | string | null } | null | undefined,
  now = new Date(),
) {
  return Boolean(connection && (connection.syncPending || isAutomaticRefreshStale(connection.lastSyncAt, now)));
}
