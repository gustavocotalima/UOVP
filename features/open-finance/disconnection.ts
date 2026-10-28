import { Prisma } from "@prisma/client";
import { projectAccountInvestment } from "@/features/finance/account-investments";
import { OperationLeaseLostError, type UserOperationLeaseContext, withUserOperationLease } from "@/lib/operation-security";
import { prisma } from "@/lib/prisma";
import { PLUGGY_DIAGRAM_EXCLUSION_REASON } from "./diagram-exclusion";
import { hasPluggyQuantityOverride } from "./investment-quantity-override";
import { resolveContributionQuantity } from "./contribution-quantity";

async function invalidatePortfolioAfterDisconnection(
  tx: Prisma.TransactionClient,
  userId: string,
  portfolioId: string | null,
) {
  if (portfolioId) {
    await tx.portfolio.update({
      where: { id: portfolioId },
      data: { version: { increment: 1 } },
    });
  }
  await tx.contributionSimulation.updateMany({
    where: { userId, status: "DRAFT" },
    data: { status: "STALE" },
  });
}

async function markPluggyItemDisconnectedUnlocked(
  pluggyItemId: string,
  lease: UserOperationLeaseContext,
) {
  const item = await prisma.pluggyItem.findUnique({
    where: { pluggyItemId },
    include: {
      investments: {
        include: {
          diagramLink: {
            include: {
              holding: {
                include: { asset: { select: { portfolioId: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!item) return null;
  if (item.status === "DELETED" && item.disconnectionResolution && item.disconnectionResolution !== "PENDING") {
    return { userId: item.userId, itemId: item.id };
  }
  const now = new Date();

  await lease.runFencedTransaction(async (tx) => {
    await tx.pluggyItem.update({
      where: { id: item.id },
      data: {
        status: "DELETED",
        executionStatus: null,
        syncPending: false,
        disconnectedAt: now,
        disconnectionResolution: "PENDING",
      },
    });
    await tx.financialAccount.updateMany({
      where: {
        userId: item.userId,
        source: "PLUGGY",
        providerItemId: item.pluggyItemId,
      },
      data: { active: true },
    });
    await tx.pluggyInvestment.updateMany({
      where: { pluggyItemDbId: item.id, status: "ACTIVE" },
      data: { providerAvailable: true, providerRemovedAt: null },
    });
    const mappedHoldingIds = item.investments.flatMap((investment) =>
      investment.status === "ACTIVE"
      && investment.diagramLink?.status === "MAPPED"
      && investment.diagramLink.holding
      && !hasPluggyQuantityOverride(investment.diagramLink)
        ? [investment.diagramLink.holding.id]
        : [],
    );
    if (mappedHoldingIds.length) {
      await tx.assetHolding.updateMany({
        where: { id: { in: mappedHoldingIds } },
        data: { includedInTotals: true },
      });
    }
    if (item.investments.length) {
      await tx.pluggyInvestmentDiagramLink.updateMany({
        where: { pluggyInvestmentDbId: { in: item.investments.map((investment) => investment.id) } },
        data: { lastReconciledAt: now },
      });
    }
  });

  return { userId: item.userId, itemId: item.id };
}

export async function markPluggyItemDisconnected(
  pluggyItemId: string,
  lease?: UserOperationLeaseContext,
) {
  const item = await prisma.pluggyItem.findUnique({
    where: { pluggyItemId },
    select: { userId: true },
  });
  if (!item) return null;
  if (lease) {
    if (lease.userId !== item.userId || lease.operation !== "pluggy-sync") {
      throw new OperationLeaseLostError();
    }
    return markPluggyItemDisconnectedUnlocked(pluggyItemId, lease);
  }
  return withUserOperationLease({
    userId: item.userId,
    operation: "pluggy-sync",
    leaseMs: 10 * 60_000,
    action: (lease) => markPluggyItemDisconnectedUnlocked(pluggyItemId, lease),
  });
}

async function resolvePluggyItemDisconnectionUnlocked(
  userId: string,
  itemId: string,
  resolution: "KEEP_MANUAL" | "REMOVE",
  lease: UserOperationLeaseContext,
) {
  const item = await prisma.pluggyItem.findFirst({
    where: {
      id: itemId,
      userId,
      status: "DELETED",
      disconnectionResolution: "PENDING",
    },
    include: {
      investments: {
        include: {
          diagramLink: {
            include: {
              holding: {
                include: { asset: { select: { portfolioId: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!item) throw new Error("A conexão desconectada não foi encontrada.");
  const linked = item.investments.flatMap((investment) =>
    investment.diagramLink?.holding
      ? [{
          investment,
          link: investment.diagramLink,
          holding: investment.diagramLink.holding,
        }]
      : [],
  );
  const portfolioId = linked[0]?.holding.asset.portfolioId ?? null;
  const now = new Date();

  await lease.runFencedTransaction(async (tx) => {
    for (const entry of linked) {
      await resolveContributionQuantity(tx, entry.link.id, resolution === "KEEP_MANUAL" ? "DISCONNECTED_MANUAL" : "USER_REMOVED");
      const userExcluded = entry.link.status === "EXCLUDED"
        && entry.link.reviewReason === PLUGGY_DIAGRAM_EXCLUSION_REASON.USER;
      if (resolution === "KEEP_MANUAL") {
        const providerValue = entry.holding.providerCurrentValue
          ?? entry.holding.currentValue
          ?? entry.investment.balance;
        await tx.assetHolding.update({
          where: { id: entry.holding.id },
          data: {
            positionSource: "MANUAL",
            pricingSource: entry.holding.pricingSource === "PLUGGY" ? "MANUAL" : entry.holding.pricingSource,
            currentValue: entry.holding.pricingSource === "PLUGGY" ? entry.holding.currentValue ?? providerValue : entry.holding.currentValue,
            providerCurrentValue: null,
            includedInTotals: !userExcluded && (
              hasPluggyQuantityOverride(entry.link)
                ? entry.holding.includedInTotals
                : entry.investment.status === "ACTIVE"
            ),
            supersededAt: null,
          },
        });
      }
      await tx.pluggyInvestmentDiagramLink.update({
        where: { id: entry.link.id },
        data: {
          assetHoldingId: resolution === "KEEP_MANUAL" ? null : entry.holding.id,
          status: "EXCLUDED",
          classificationSource: "USER_OVERRIDE",
          ...(resolution === "KEEP_MANUAL" ? {
            metadataOverrideFields: { set: [] },
            overrideProductName: null,
            overrideIssuer: null,
            overrideCatalogItemId: null,
            overrideCustomTypeName: null,
            overrideRateConvention: null,
            overrideBenchmark: null,
            overrideRateValue: null,
            overridePurchaseDate: null,
            overrideMaturityDate: null,
            overrideQuantity: null,
            overrideQuantityProviderQuantity: null,
            overrideQuantityAcknowledgedAt: null,
            metadataOverrideUpdatedAt: null,
          } : {}),
          reviewReason: userExcluded
            ? PLUGGY_DIAGRAM_EXCLUSION_REASON.USER
            : resolution === "KEEP_MANUAL"
              ? PLUGGY_DIAGRAM_EXCLUSION_REASON.CONNECTION_KEEP_MANUAL
              : PLUGGY_DIAGRAM_EXCLUSION_REASON.CONNECTION_REMOVE,
          lastReconciledAt: new Date(),
        },
      });
    }
    const accounts = await tx.financialAccount.findMany({
      where: {
        userId,
        source: "PLUGGY",
        providerItemId: item.pluggyItemId,
      },
      select: { id: true },
    });
    const accountIds = accounts.map((account) => account.id);
    if (resolution === "KEEP_MANUAL") {
      if (accountIds.length) {
        await tx.financeTransaction.updateMany({
          where: {
            userId,
            accountId: { in: accountIds },
            source: "PLUGGY",
          },
          data: {
            source: "MANUAL",
            externalId: null,
            balanceApplied: false,
            providerLifecycle: "KEPT_MANUAL",
            providerDeletedAt: now,
          },
        });
      }
      await tx.financialAccount.updateMany({
        where: { id: { in: accountIds } },
        data: {
          source: "MANUAL",
          externalId: null,
          providerItemId: null,
          active: true,
        },
      });
    } else {
      if (accountIds.length) {
        await tx.financeTransaction.updateMany({
          where: { userId, accountId: { in: accountIds }, source: "PLUGGY" },
          data: {
            providerLifecycle: "REMOVED",
            providerDeletedAt: now,
          },
        });
      }
      await tx.financialAccount.updateMany({
        where: { id: { in: accountIds } },
        data: { active: false },
      });
      if (linked.length) {
        await tx.assetHolding.updateMany({
          where: { id: { in: linked.map((entry) => entry.holding.id) } },
          data: { includedInTotals: false },
        });
      }
    }
    await tx.pluggyInvestment.updateMany({
      where: { pluggyItemDbId: item.id },
      data: { providerAvailable: false, providerRemovedAt: now },
    });
    for (const accountId of accountIds) await projectAccountInvestment(tx, accountId);
    await tx.pluggyItem.update({
      where: { id: item.id },
      data: { disconnectionResolution: resolution },
    });
    await invalidatePortfolioAfterDisconnection(tx, userId, portfolioId);
  });
}

export async function resolvePluggyItemDisconnection(
  userId: string,
  itemId: string,
  resolution: "KEEP_MANUAL" | "REMOVE",
) {
  const item = await prisma.pluggyItem.findFirst({
    where: { id: itemId, userId },
    select: { id: true },
  });
  if (!item) throw new Error("A conexão desconectada não foi encontrada.");
  return withUserOperationLease({
    userId,
    operation: "pluggy-sync",
    leaseMs: 10 * 60_000,
    action: (lease) => resolvePluggyItemDisconnectionUnlocked(userId, item.id, resolution, lease),
  });
}
