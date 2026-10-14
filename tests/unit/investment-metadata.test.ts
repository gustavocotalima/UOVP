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
        status: "MAPPED",
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
        quantity: new Prisma.Decimal(1),
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
        quantity: new Prisma.Decimal(1),
        fractional: true,
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
      canEditQuantity: false,
      quantityStep: 0.0000000001,
      effectiveMetadata: {
        quantity: "1",
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
        quantity: "1",
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

  function marketInput(): Parameters<typeof connectedInvestmentMetadataDto>[0] {
    return {
      link: {
        id: "cm_market_link",
        updatedAt: new Date("2026-10-14T10:00:00Z"),
        metadataOverrideUpdatedAt: new Date("2026-10-14T10:00:00Z"),
        metadataOverrideFields: ["QUANTITY"],
        status: "MAPPED",
      },
      investment: {
        name: "Ativo conectado",
        type: "STOCK",
        subtype: null,
        issuerCnpj: null,
        rate: null,
        rateType: null,
        fixedAnnualRate: null,
        annualRate: null,
        purchaseDate: null,
        dueDate: null,
        quantity: new Prisma.Decimal(0),
        source: "INVESTMENTS_API",
        providerAvailable: true,
        item: { status: "UPDATED", disconnectedAt: null },
      },
      holding: {
        productName: "Ativo conectado",
        issuer: "Emissor",
        catalogItemId: null,
        customTypeName: null,
        rateConvention: null,
        benchmark: null,
        rateValue: null,
        purchaseDate: null,
        maturityDate: null,
        quantity: new Prisma.Decimal(110),
        fractional: false,
        positionSource: "PLUGGY",
        asset: { instrumentType: "STOCK", fixedIncomeFamilyCode: null },
      },
      providerIssuer: "Emissor da instituição",
    };
  }

  it("expõe separadamente a quantidade temporária e a quantidade original", () => {
    const dto = connectedInvestmentMetadataDto(marketInput());
    expect(dto?.canEditQuantity).toBe(true);
    expect(dto?.quantityStep).toBe(1);
    expect(dto?.overrideFields).toContain("QUANTITY");
    expect(dto?.effectiveMetadata.quantity).toBe("110");
    expect(dto?.providerMetadata.quantity).toBe("0");
  });

  it("preserva quantidades fracionárias sem convertê-las em dinheiro", () => {
    const input = marketInput();
    input.holding!.fractional = true;
    input.holding!.quantity = new Prisma.Decimal("1.1234567891");
    input.investment.quantity = null;
    const dto = connectedInvestmentMetadataDto(input);
    expect(dto?.quantityStep).toBe(0.0000000001);
    expect(dto?.effectiveMetadata.quantity).toBe("1.1234567891");
    expect(dto?.providerMetadata.quantity).toBeNull();
  });

  it("usa as mesmas regras de frações do mercado da Carteira", () => {
    const input = marketInput();
    input.holding!.fractional = true;
    input.holding!.pricingSource = "BRAPI";
    expect(connectedInvestmentMetadataDto(input)?.quantityStep).toBe(1);
    input.holding!.fractional = false;
    input.holding!.pricingSource = "YAHOO";
    expect(connectedInvestmentMetadataDto(input)?.quantityStep).toBe(0.0000000001);
  });

  it.each(["NEEDS_REVIEW", "EXCLUDED"])("não permite quantidade para vínculo %s", (status) => {
    const input = marketInput();
    input.link!.status = status;
    expect(connectedInvestmentMetadataDto(input)?.canEditQuantity).toBe(false);
  });

  it("não permite quantidade para posição ausente, conexão removida ou item não carregado", () => {
    const input = marketInput();
    input.investment.providerAvailable = false;
    expect(connectedInvestmentMetadataDto(input)?.canEditQuantity).toBe(false);
    input.investment.providerAvailable = true;
    input.investment.item = { status: "DELETED", disconnectedAt: null };
    expect(connectedInvestmentMetadataDto(input)?.canEditQuantity).toBe(false);
    input.investment.item = { status: "UPDATED", disconnectedAt: new Date() };
    expect(connectedInvestmentMetadataDto(input)?.canEditQuantity).toBe(false);
    input.investment.item = undefined;
    expect(connectedInvestmentMetadataDto(input)?.canEditQuantity).toBe(false);
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
