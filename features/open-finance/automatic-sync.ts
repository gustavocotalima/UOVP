import { selectPluggyItemsForAutomaticSync } from "@/lib/automatic-refresh-policy";
import {
  OperationInProgressError,
  withUserOperationLease,
} from "@/lib/operation-security";
import { prisma } from "@/lib/prisma";
import { syncSelectedPluggyItemsForUser } from "./sync";

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
      pluggyItemId: true,
      syncPending: true,
      lastSyncAt: true,
    },
  });
  const selectedItems = selectPluggyItemsForAutomaticSync(items);
  if (!selectedItems.length) {
    return {
      status: "SKIPPED",
      changed: false,
      reason: null,
      requestedConnections: selectedItems.length,
      updatedConnections: 0,
      failedConnections: 0,
      message: null,
    };
  }
  const reason = selectedItems.some((item) => item.syncPending)
    ? "WEBHOOK_PENDING"
    : "AUTOMATIC_STALE";
  try {
    return await withUserOperationLease({
      userId,
      operation: "pluggy-bootstrap",
      leaseMs: 12 * 60_000,
      action: async () => {
        const result = await syncSelectedPluggyItemsForUser(
          userId,
          selectedItems.map((item) => item.pluggyItemId),
          { automatic: true },
        );
        const changed = result.changed;
        const selectedReason = !result.itemCount
          ? null
          : result.pendingItemCount
            ? "WEBHOOK_PENDING" as const
            : "AUTOMATIC_STALE" as const;
        return {
          status: !result.itemCount
            ? "SKIPPED" as const
            : result.failedItemCount
              ? changed ? "PARTIAL" as const : "FAILED" as const
              : result.partialItemCount
                ? "PARTIAL" as const
                : "UPDATED" as const,
          changed,
          reason: selectedReason,
          requestedConnections: result.itemCount,
          updatedConnections: result.succeededItemCount,
          failedConnections: result.failedItemCount,
          message: result.failedItemCount
            ? `${result.failedItemCount} conexão(ões) não puderam ser concluídas.${result.partiallyUpdatedItemCount ? " Parte dos dados já foi atualizada." : ""}`
            : result.partialItemCount
              ? `${result.partialItemCount} conexão(ões) não informaram todos os saldos reservados.`
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
        requestedConnections: selectedItems.length,
        updatedConnections: 0,
        failedConnections: 0,
        message: null,
      };
    }
    return {
      status: "FAILED",
      changed: false,
      reason,
      requestedConnections: selectedItems.length,
      updatedConnections: 0,
      failedConnections: selectedItems.length,
      message: error instanceof Error ? error.message : "Não foi possível sincronizar o Open Finance.",
    };
  }
}
