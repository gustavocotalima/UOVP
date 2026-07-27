import { shouldSyncPluggyItems } from "@/lib/automatic-refresh-policy";
import {
  OperationInProgressError,
  withUserOperationLease,
} from "@/lib/operation-security";
import { prisma } from "@/lib/prisma";
import { syncAllPluggyItemsForUser } from "./sync";

export type AutomaticPluggySyncResult = {
  status: "SKIPPED" | "UPDATED" | "PARTIAL" | "FAILED";
  changed: boolean;
  reason: "AUTOMATIC_STALE" | "WEBHOOK_PENDING" | null;
  requestedConnections: number;
  updatedConnections: number;
  failedConnections: number;
  message: string | null;
};

export async function syncStalePluggyItemsForUser(
  userId: string,
): Promise<AutomaticPluggySyncResult> {
  const items = await prisma.pluggyItem.findMany({
    where: { userId, status: { not: "DELETED" } },
    select: {
      syncPending: true,
      lastSyncAt: true,
    },
  });
  if (!shouldSyncPluggyItems(items)) {
    return {
      status: "SKIPPED",
      changed: false,
      reason: null,
      requestedConnections: items.length,
      updatedConnections: 0,
      failedConnections: 0,
      message: null,
    };
  }
  const reason = items.some((item) => item.syncPending)
    ? "WEBHOOK_PENDING"
    : "AUTOMATIC_STALE";
  try {
    return await withUserOperationLease({
      userId,
      operation: "pluggy-bootstrap",
      leaseMs: 12 * 60_000,
      action: async () => {
        const result = await syncAllPluggyItemsForUser(userId);
        const changed = result.succeededItemCount > 0;
        return {
          status: result.failedItemCount
            ? changed ? "PARTIAL" as const : "FAILED" as const
            : "UPDATED" as const,
          changed,
          reason,
          requestedConnections: result.itemCount,
          updatedConnections: result.succeededItemCount,
          failedConnections: result.failedItemCount,
          message: result.failedItemCount
            ? `${result.failedItemCount} conexão(ões) não puderam ser sincronizadas.`
            : null,
        };
      },
    });
  } catch (error) {
    if (error instanceof OperationInProgressError) {
      return {
        status: "SKIPPED",
        changed: false,
        reason,
        requestedConnections: items.length,
        updatedConnections: 0,
        failedConnections: 0,
        message: null,
      };
    }
    return {
      status: "FAILED",
      changed: false,
      reason,
      requestedConnections: items.length,
      updatedConnections: 0,
      failedConnections: items.length,
      message: error instanceof Error ? error.message : "Não foi possível sincronizar o Open Finance.",
    };
  }
}
