import type { BinanceConnectionStatus } from "@/features/portfolio/binance-wallet-credentials";

export type BinanceWalletSnapshotState = { status: BinanceConnectionStatus; requestId: number };

/** DB snapshot order wins; local request order breaks ties at the same revision. */
export function selectBinanceWalletSnapshot(current: BinanceWalletSnapshotState, incoming: BinanceWalletSnapshotState) {
  const previousRevision = BigInt(current.status.snapshotRevision);
  const nextRevision = BigInt(incoming.status.snapshotRevision);
  if (nextRevision < previousRevision || (nextRevision === previousRevision && incoming.requestId < current.requestId)) {
    return current;
  }
  return incoming;
}
