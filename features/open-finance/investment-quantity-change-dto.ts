import type { Prisma } from "@prisma/client";
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
  if (!link || !holding || !canEditPluggyInvestmentQuantity({ link, investment, holding })) return null;
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
