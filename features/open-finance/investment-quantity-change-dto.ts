import type { Prisma } from "@/generated/prisma/client";
import type { PluggyQuantityChangeDto } from "@/features/portfolio/types";
import { canEditPluggyInvestmentQuantity, pendingPluggyQuantityChange } from "./investment-quantity-override";
import { resolvePluggyInstitutionName } from "./institution-logo";

export function pluggyQuantityChangeDto({ link, investment, holding }: {
  link: {
    id: string;
    status: string;
    updatedAt: Date;
    metadataOverrideFields: readonly string[];
    overrideQuantity: Prisma.Decimal | null;
    overrideQuantityProviderQuantity: Prisma.Decimal | null;
    overrideQuantityAcknowledgedAt: Date | null;
    contributionBatches?: { id: string; state: string; revision: number; expectedQuantity: Prisma.Decimal; acknowledgedQuantity: Prisma.Decimal; suggestions: { executionStatus: string }[] }[];
  } | null;
  investment: {
    source: string;
    providerAvailable: boolean;
    quantity: Prisma.Decimal | null;
    item: {
      status: string;
      disconnectedAt: Date | null;
      displayName?: string | null;
      institutionName?: string | null;
      connectorName?: string | null;
    };
  };
  holding: {
    positionSource: string;
    productName: string;
    ticker: string | null;
    asset: { instrumentType: string };
  } | null;
}): PluggyQuantityChangeDto | null {
  if (!link || !holding) return null;
  const batch = link.contributionBatches?.[0];
  if (batch) {
    if (batch.state !== "CONFLICT" || investment.item.status === "DELETED" || investment.item.disconnectedAt) return null;
    return {
      linkId: link.id, expectedUpdatedAt: link.updatedAt.toISOString(),
      name: holding.productName, ticker: holding.ticker,
      institution: investment.item.displayName?.trim() || resolvePluggyInstitutionName(investment.item.institutionName, investment.item.connectorName, []),
      previousProviderQuantity: batch.acknowledgedQuantity.toString(), providerQuantity: investment.quantity?.toString() ?? null,
      manualQuantity: batch.expectedQuantity.toString(), contributionBatchId: batch.id, expectedRevision: batch.revision,
      pendingContributions: batch.suggestions.filter((s) => s.executionStatus === "AWAITING_SYNC").length,
    };
  }
  if (!canEditPluggyInvestmentQuantity({ link, investment, holding })) return null;
  const change = pendingPluggyQuantityChange(investment.quantity, link);
  return change ? {
    ...change,
    linkId: link.id,
    expectedUpdatedAt: link.updatedAt.toISOString(),
    name: holding.productName,
    ticker: holding.ticker,
    institution: investment.item.displayName?.trim()
      || resolvePluggyInstitutionName(investment.item.institutionName, investment.item.connectorName, []),
  } : null;
}
