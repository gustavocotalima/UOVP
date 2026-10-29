import type { InvestmentClass, PricingSource, RateConvention } from "@/generated/prisma/client";
import type {
  ConnectedInvestmentMetadataDto,
  PluggyInvestmentMetadataOverrideField,
} from "@/features/portfolio/types";
import type { InstrumentTypeKey } from "@/features/portfolio/constants";
import { allowsFractionalUnits } from "@/features/portfolio/fractional-assets";
import { canEditPluggyInvestmentQuantity } from "./investment-quantity-override";

type MetadataInput = {
  link: {
    id: string;
    updatedAt: Date;
    metadataOverrideUpdatedAt: Date | null;
    metadataOverrideFields: string[];
    status?: string;
  } | null;
  investment: {
    name: string;
    type: string;
    subtype: string | null;
    issuerCnpj: string | null;
    rate: { toString(): string } | null;
    rateType: string | null;
    fixedAnnualRate: { toString(): string } | null;
    annualRate: { toString(): string } | null;
    purchaseDate: Date | null;
    dueDate: Date | null;
    quantity?: { toString(): string } | null;
    source?: string;
    providerAvailable?: boolean;
    item?: { status?: string; disconnectedAt?: Date | null } | null;
  };
  holding: {
    productName: string;
    issuer: string;
    catalogItemId: number | null;
    customTypeName: string | null;
    rateConvention: RateConvention | null;
    benchmark: string | null;
    rateValue: { toString(): string } | null;
    purchaseDate: Date | null;
    maturityDate: Date | null;
    quantity?: { toString(): string };
    fractional?: boolean;
    positionSource?: string;
    pricingSource?: PricingSource;
    asset: {
      instrumentType: InstrumentTypeKey;
      fixedIncomeFamilyCode: string | null;
      investmentClass?: InvestmentClass;
    };
  } | null;
  providerIssuer: string;
};

const overrideFields = new Set<PluggyInvestmentMetadataOverrideField>([
  "PRODUCT_NAME",
  "ISSUER",
  "PRODUCT_TYPE",
  "RATE_TERMS",
  "PURCHASE_DATE",
  "MATURITY_DATE",
  "QUANTITY",
]);

export function connectedInvestmentMetadataDto({
  link,
  investment,
  holding,
  providerIssuer,
}: MetadataInput): ConnectedInvestmentMetadataDto | null {
  if (!link || !holding) return null;
  return {
    linkId: link.id,
    expectedUpdatedAt: link.updatedAt.toISOString(),
    metadataOverrideUpdatedAt: link.metadataOverrideUpdatedAt?.toISOString() ?? null,
    overrideFields: link.metadataOverrideFields.filter(
      (field): field is PluggyInvestmentMetadataOverrideField => overrideFields.has(field as PluggyInvestmentMetadataOverrideField),
    ),
    instrumentType: holding.asset.instrumentType,
    fixedIncomeFamilyCode: holding.asset.fixedIncomeFamilyCode,
    canEditMetadata: true,
    canEditQuantity: canEditPluggyInvestmentQuantity({
      link: { status: link.status ?? "" },
      investment,
      holding,
    }),
    quantityStep: allowsFractionalUnits({
      instrumentType: holding.asset.instrumentType,
      investmentClass: holding.asset.investmentClass ?? null,
      pricingSource: holding.pricingSource ?? null,
      fallback: holding.fractional,
    }) ? 0.0000000001 : 1,
    effectiveMetadata: {
      quantity: holding.quantity?.toString() ?? "0",
      productName: holding.productName,
      issuer: holding.issuer,
      catalogItemId: holding.catalogItemId,
      customTypeName: holding.customTypeName,
      rateConvention: holding.rateConvention,
      benchmark: holding.benchmark,
      rateValue: holding.rateValue?.toString() ?? null,
      purchaseDate: holding.purchaseDate?.toISOString() ?? null,
      maturityDate: holding.maturityDate?.toISOString() ?? null,
    },
    providerMetadata: {
      quantity: investment.quantity?.toString() ?? null,
      productName: investment.name,
      issuer: providerIssuer,
      type: investment.type,
      subtype: investment.subtype,
      rate: investment.rate?.toString() ?? null,
      rateType: investment.rateType,
      fixedAnnualRate: investment.fixedAnnualRate?.toString() ?? null,
      annualRate: investment.annualRate?.toString() ?? null,
      purchaseDate: investment.purchaseDate?.toISOString() ?? null,
      maturityDate: investment.dueDate?.toISOString() ?? null,
      issuerCnpj: investment.issuerCnpj,
    },
  };
}
