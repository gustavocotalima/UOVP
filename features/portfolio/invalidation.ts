import type { Prisma } from "@prisma/client";

export async function invalidateDraftContributionSimulations(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.contributionSimulation.updateMany({
    where: { userId, status: "DRAFT" },
    data: { status: "STALE" },
  });
}

export async function bumpPortfolioAndInvalidateDrafts(
  tx: Prisma.TransactionClient,
  portfolioId: string,
  userId: string,
) {
  await tx.portfolio.update({
    where: { id: portfolioId },
    data: { version: { increment: 1 } },
  });
  await invalidateDraftContributionSimulations(tx, userId);
}
