import type { RateConvention } from "@prisma/client";
import type {
  ConnectedInvestmentMetadataDto,
  PluggyInvestmentMetadataOverrideField,
} from "@/features/portfolio/types";
import type { InstrumentTypeKey } from "@/features/portfolio/constants";

type MetadataInput = {
  link: {
    id: string;
    updatedAt: Date;
    metadataOverrideUpdatedAt: Date | null;
    metadataOverrideFields: string[];
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
    asset: {
      instrumentType: InstrumentTypeKey;
      fixedIncomeFamilyCode: string | null;
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
    effectiveMetadata: {
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
