import { Prisma } from "@prisma/client";
import { withUserOperationLease } from "@/lib/operation-security";
import { prisma } from "@/lib/prisma";

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

async function markPluggyItemDisconnectedUnlocked(pluggyItemId: string) {
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
  const holdings = item.investments.flatMap((investment) =>
    investment.diagramLink?.holding ? [investment.diagramLink.holding] : [],
  );
  const portfolioId = holdings[0]?.asset.portfolioId ?? null;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
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
      data: { active: false },
    });
    await tx.pluggyInvestment.updateMany({
      where: { pluggyItemDbId: item.id },
      data: { providerAvailable: false, providerRemovedAt: now },
    });
    if (holdings.length) {
      await tx.assetHolding.updateMany({
        where: { id: { in: holdings.map((holding) => holding.id) } },
        data: { includedInTotals: false },
      });
      await tx.pluggyInvestmentDiagramLink.updateMany({
        where: { pluggyInvestmentDbId: { in: item.investments.map((investment) => investment.id) } },
        data: { lastReconciledAt: now },
      });
    }
    await invalidatePortfolioAfterDisconnection(tx, item.userId, portfolioId);
  });

  return { userId: item.userId, itemId: item.id };
}

export async function markPluggyItemDisconnected(pluggyItemId: string) {
  const item = await prisma.pluggyItem.findUnique({
    where: { pluggyItemId },
    select: { userId: true },
  });
  if (!item) return null;
  return withUserOperationLease({
    userId: item.userId,
    operation: "pluggy-sync",
    leaseMs: 10 * 60_000,
    action: () => markPluggyItemDisconnectedUnlocked(pluggyItemId),
  });
}

async function resolvePluggyItemDisconnectionUnlocked(
  userId: string,
  itemId: string,
  resolution: "KEEP_MANUAL" | "REMOVE",
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

  await prisma.$transaction(async (tx) => {
    for (const entry of linked) {
      if (resolution === "KEEP_MANUAL") {
        const providerValue = entry.holding.providerCurrentValue
          ?? entry.holding.currentValue
          ?? entry.investment.balance;
        await tx.assetHolding.update({
          where: { id: entry.holding.id },
          data: {
            positionSource: "MANUAL",
            pricingSource: entry.holding.pricingSource === "PLUGGY" ? "MANUAL" : entry.holding.pricingSource,
            currentValue: entry.holding.pricingSource === "PLUGGY" ? providerValue : entry.holding.currentValue,
            providerCurrentValue: null,
            includedInTotals: entry.investment.status === "ACTIVE",
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
          reviewReason: resolution === "KEEP_MANUAL"
            ? "Posição mantida manualmente após a desconexão da instituição."
            : "Posição removida do diagrama após a desconexão da instituição.",
          lastReconciledAt: new Date(),
        },
      });
    }
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
    action: () => resolvePluggyItemDisconnectionUnlocked(userId, item.id, resolution),
  });
}
