import { Prisma } from "@prisma/client";

type QuantityOverrideLink = {
  metadataOverrideFields: readonly string[];
  overrideQuantity?: Prisma.Decimal | null;
  overrideQuantityProviderQuantity?: Prisma.Decimal | null;
  overrideQuantityAcknowledgedAt?: Date | null;
};

type QuantityEditContext = {
  link: { status: string } | null;
  investment: {
    source?: string;
    providerAvailable?: boolean;
    item?: { status?: string; disconnectedAt?: Date | null } | null;
  };
  holding: {
    positionSource?: string;
    asset: { instrumentType: string };
  } | null;
};

/** Quantity corrections never restore a removed connection or an excluded position. */
export function canEditPluggyInvestmentQuantity({ link, investment, holding }: QuantityEditContext) {
  return link?.status === "MAPPED"
    && holding?.positionSource === "PLUGGY"
    && ["STOCK", "ETF", "REAL_ESTATE_FUND", "REIT"].includes(holding.asset.instrumentType)
    && investment.source === "INVESTMENTS_API"
    && investment.providerAvailable === true
    && investment.item != null
    && typeof investment.item.status === "string"
    && investment.item.status !== "DELETED"
    && investment.item.disconnectedAt == null;
}

export function hasPluggyQuantityOverride(link: QuantityOverrideLink | null | undefined) {
  return link?.metadataOverrideFields.includes("QUANTITY") === true
    && link.overrideQuantity != null
    && link.overrideQuantity.isFinite()
    && link.overrideQuantity.gte(0);
}

export function effectivePluggyQuantity(
  providerQuantity: Prisma.Decimal | null,
  link: QuantityOverrideLink | null | undefined,
) {
  return hasPluggyQuantityOverride(link)
    ? link!.overrideQuantity!
    : providerQuantity ?? new Prisma.Decimal(0);
}

export function samePluggyQuantity(left: Prisma.Decimal | null, right: Prisma.Decimal | null) {
  return left === null || right === null ? left === right : left.eq(right);
}

/** Compare quantities, not prices or provider timestamps. Acknowledgment is durable. */
export function pendingPluggyQuantityChange(
  providerQuantity: Prisma.Decimal | null,
  link: QuantityOverrideLink | null | undefined,
) {
  if (!hasPluggyQuantityOverride(link)
    || !link?.overrideQuantityAcknowledgedAt
    || (providerQuantity !== null && (!providerQuantity.isFinite() || providerQuantity.lt(0)))
    || samePluggyQuantity(link.overrideQuantityProviderQuantity ?? null, providerQuantity)) return null;
  return {
    previousProviderQuantity: link.overrideQuantityProviderQuantity?.toString() ?? null,
    providerQuantity: providerQuantity?.toString() ?? null,
    manualQuantity: link.overrideQuantity!.toString(),
  };
}
