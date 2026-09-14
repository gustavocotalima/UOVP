import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { connectedInvestmentMetadataDto } from "@/features/open-finance/investment-metadata-dto";

describe("metadados efetivos de investimentos conectados", () => {
  it("mantém o snapshot da instituição separado dos valores efetivos", () => {
    const dto = connectedInvestmentMetadataDto({
      link: {
        id: "cm_link",
        updatedAt: new Date("2026-09-14T10:00:00.000Z"),
        metadataOverrideUpdatedAt: new Date("2026-09-14T09:00:00.000Z"),
        metadataOverrideFields: ["PRODUCT_NAME", "ISSUER", "RATE_TERMS"],
      },
      investment: {
        name: "CDB ORIGINAL",
        type: "FIXED_INCOME",
        subtype: "CDB",
        issuerCnpj: "00.000.000/0001-00",
        rate: new Prisma.Decimal(0),
        rateType: "CDI",
        fixedAnnualRate: new Prisma.Decimal("8.95"),
        annualRate: null,
        purchaseDate: new Date("2026-06-15T12:00:00.000Z"),
        dueDate: new Date("2027-08-24T12:00:00.000Z"),
      },
      holding: {
        productName: "CDB corrigido",
        issuer: "Banco Pine S.A.",
        catalogItemId: null,
        customTypeName: "CDB sem cobertura informada",
        rateConvention: "FIXED_ANNUAL",
        benchmark: null,
        rateValue: new Prisma.Decimal("14.85"),
        purchaseDate: new Date("2026-06-16T12:00:00.000Z"),
        maturityDate: new Date("2027-08-25T12:00:00.000Z"),
        asset: {
          instrumentType: "FIXED_INCOME",
          fixedIncomeFamilyCode: "BANK_DEPOSITS_FGC",
        },
      },
      providerIssuer: "BANCO PINE S/A",
    });

    expect(dto).toEqual({
      linkId: "cm_link",
      expectedUpdatedAt: "2026-09-14T10:00:00.000Z",
      metadataOverrideUpdatedAt: "2026-09-14T09:00:00.000Z",
      overrideFields: ["PRODUCT_NAME", "ISSUER", "RATE_TERMS"],
      instrumentType: "FIXED_INCOME",
      fixedIncomeFamilyCode: "BANK_DEPOSITS_FGC",
      canEditMetadata: true,
      effectiveMetadata: {
        productName: "CDB corrigido",
        issuer: "Banco Pine S.A.",
        catalogItemId: null,
        customTypeName: "CDB sem cobertura informada",
        rateConvention: "FIXED_ANNUAL",
        benchmark: null,
        rateValue: "14.85",
        purchaseDate: "2026-06-16T12:00:00.000Z",
        maturityDate: "2027-08-25T12:00:00.000Z",
      },
      providerMetadata: {
        productName: "CDB ORIGINAL",
        issuer: "BANCO PINE S/A",
        type: "FIXED_INCOME",
        subtype: "CDB",
        rate: "0",
        rateType: "CDI",
        fixedAnnualRate: "8.95",
        annualRate: null,
        purchaseDate: "2026-06-15T12:00:00.000Z",
        maturityDate: "2027-08-24T12:00:00.000Z",
        issuerCnpj: "00.000.000/0001-00",
      },
    });
  });

  it("não expõe edição quando a posição ainda não possui vínculo e holding", () => {
    expect(connectedInvestmentMetadataDto({
      link: null,
      investment: {
        name: "Sem vínculo",
        type: "OTHER",
        subtype: null,
        issuerCnpj: null,
        rate: null,
        rateType: null,
        fixedAnnualRate: null,
        annualRate: null,
        purchaseDate: null,
        dueDate: null,
      },
      holding: null,
      providerIssuer: "Instituição",
    })).toBeNull();
  });
});
