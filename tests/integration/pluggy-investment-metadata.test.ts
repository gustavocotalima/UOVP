import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { reconcilePluggyInvestmentsForUser } from "@/features/open-finance/diagram-sync";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("overrides de metadados dos investimentos Pluggy", () => {
  const suffix = Date.now().toString();
  let userId = "";
  let itemId = "";
  let investmentId = "";
  let linkId = "";
  let holdingId = "";

  beforeAll(async () => {
    await db!.fixedIncomeFamily.upsert({
      where: { code: "BANK_DEPOSITS_FGC" },
      update: {},
      create: {
        code: "BANK_DEPOSITS_FGC",
        name: "Depósitos bancários com FGC",
        shortCode: "CDB/RDB/LC",
        sortOrder: 10,
      },
    });
    await db!.assetCatalogItem.upsert({
      where: { id: 5 },
      update: {},
      create: {
        id: 5,
        category: "Renda fixa",
        name: "CDB",
        summary: "Certificado de depósito bancário.",
        taxPF: "Conforme legislação vigente.",
        taxPJ: "Conforme legislação vigente.",
        howToBuy: "Instituição financeira.",
        costs: "Conforme instituição.",
        risks: "Risco de crédito.",
        guarantees: "Conforme elegibilidade ao FGC.",
        familyCode: "BANK_DEPOSITS_FGC",
      },
    });
    const user = await db!.user.create({
      data: {
        email: `vitest-metadata-${suffix}@example.com`,
        portfolio: { create: {} },
      },
    });
    userId = user.id;
    const item = await db!.pluggyItem.create({
      data: {
        userId,
        pluggyItemId: `metadata-item-${suffix}`,
        connectorName: "Banco Inter",
        institutionName: "Inter",
        status: "UPDATED",
        syncPending: false,
      },
    });
    itemId = item.id;
    const investment = await db!.pluggyInvestment.create({
      data: {
        pluggyItemDbId: item.id,
        pluggyInvestmentId: `metadata-investment-${suffix}`,
        name: "CDB ORIGINAL",
        issuer: "BANCO ORIGINAL S.A.",
        issuerCnpj: "00.000.000/0001-00",
        type: "FIXED_INCOME",
        subtype: "CDB",
        balance: 1_000,
        amount: 950,
        quantity: 1,
        value: 1_000,
        currencyCode: "BRL",
        rate: 110,
        rateType: "CDI",
        purchaseDate: new Date("2026-06-15T12:00:00.000Z"),
        dueDate: new Date("2027-08-24T12:00:00.000Z"),
        status: "ACTIVE",
        providerAvailable: true,
      },
    });
    investmentId = investment.id;
    await reconcilePluggyInvestmentsForUser(userId);
    const link = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({
      where: { pluggyInvestmentDbId: investment.id },
    });
    linkId = link.id;
    holdingId = link.assetHoldingId!;
  });

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("inicia sem overrides implícitos", async () => {
    const link = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(link.metadataOverrideFields).toEqual([]);
    expect(link.metadataOverrideUpdatedAt).toBeNull();
  });

  it("preserva todos os metadados customizados durante a sincronização", async () => {
    await db!.pluggyInvestmentDiagramLink.update({
      where: { id: linkId },
      data: {
        metadataOverrideFields: {
          set: ["PRODUCT_NAME", "ISSUER", "PRODUCT_TYPE", "RATE_TERMS", "PURCHASE_DATE", "MATURITY_DATE"],
        },
        overrideProductName: "CDB corrigido",
        overrideIssuer: "Banco Pine S.A.",
        overrideCatalogItemId: null,
        overrideCustomTypeName: "CDB sem garantia informada",
        overrideRateConvention: "FIXED_ANNUAL",
        overrideBenchmark: null,
        overrideRateValue: new Prisma.Decimal("14.85"),
        overridePurchaseDate: new Date("2026-06-16T12:00:00.000Z"),
        overrideMaturityDate: new Date("2027-08-25T12:00:00.000Z"),
        metadataOverrideUpdatedAt: new Date(),
      },
    });
    await db!.pluggyInvestment.update({
      where: { id: investmentId },
      data: {
        name: "CDB ALTERADO PELA PLUGGY",
        issuer: "EMISSOR ALTERADO PELA PLUGGY",
        balance: 1_125,
        quantity: 2,
        rate: 0,
        rateType: "CDI",
        fixedAnnualRate: new Prisma.Decimal("8.95"),
        purchaseDate: new Date("2026-06-17T12:00:00.000Z"),
        dueDate: new Date("2027-08-26T12:00:00.000Z"),
      },
    });

    await reconcilePluggyInvestmentsForUser(userId);

    const [link, holding, raw] = await Promise.all([
      db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: linkId } }),
      db!.assetHolding.findUniqueOrThrow({ where: { id: holdingId } }),
      db!.pluggyInvestment.findUniqueOrThrow({ where: { id: investmentId } }),
    ]);
    expect(link.metadataOverrideFields).toEqual([
      "PRODUCT_NAME",
      "ISSUER",
      "PRODUCT_TYPE",
      "RATE_TERMS",
      "PURCHASE_DATE",
      "MATURITY_DATE",
    ]);
    expect(holding).toMatchObject({
      productName: "CDB corrigido",
      issuer: "Banco Pine S.A.",
      catalogItemId: null,
      customTypeName: "CDB sem garantia informada",
      rateConvention: "FIXED_ANNUAL",
      benchmark: null,
      quantity: new Prisma.Decimal(2),
      providerCurrentValue: new Prisma.Decimal(1125),
    });
    expect(holding.rateValue?.toString()).toBe("14.85");
    expect(holding.purchaseDate?.toISOString()).toBe("2026-06-16T12:00:00.000Z");
    expect(holding.maturityDate?.toISOString()).toBe("2027-08-25T12:00:00.000Z");
    expect(raw).toMatchObject({
      name: "CDB ALTERADO PELA PLUGGY",
      issuer: "EMISSOR ALTERADO PELA PLUGGY",
      rateType: "CDI",
    });
    expect(raw.rate?.toString()).toBe("0");
    expect(raw.fixedAnnualRate?.toString()).toBe("8.95");
  });

  it("preserva overrides ao reassociar o vínculo a uma posição Open Finance", async () => {
    const replacement = await db!.pluggyInvestment.create({
      data: {
        pluggyItemDbId: itemId,
        pluggyInvestmentId: `metadata-open-finance-${suffix}`,
        name: "CDB VIA OPEN FINANCE",
        issuer: "BANCO OPEN FINANCE S.A.",
        type: "FIXED_INCOME",
        subtype: "CDB",
        balance: 1_130,
        quantity: 2,
        value: 565,
        currencyCode: "BRL",
        rate: 105,
        rateType: "CDI",
        status: "ACTIVE",
        providerAvailable: true,
      },
    });
    await db!.$transaction([
      db!.pluggyInvestment.update({
        where: { id: investmentId },
        data: { providerAvailable: false, providerRemovedAt: new Date() },
      }),
      db!.pluggyInvestmentDiagramLink.update({
        where: { id: linkId },
        data: { pluggyInvestmentDbId: replacement.id },
      }),
    ]);
    investmentId = replacement.id;

    await reconcilePluggyInvestmentsForUser(userId);

    const link = await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({
      where: { id: linkId },
      include: { holding: true },
    });
    expect(link.pluggyInvestmentDbId).toBe(replacement.id);
    expect(link.metadataOverrideFields).toContain("PRODUCT_NAME");
    expect(link.holding).toMatchObject({
      productName: "CDB corrigido",
      issuer: "Banco Pine S.A.",
      providerCurrentValue: new Prisma.Decimal(1130),
    });
  });

  it("restaura um campo sem alterar os demais overrides", async () => {
    await db!.pluggyInvestmentDiagramLink.update({
      where: { id: linkId },
      data: {
        metadataOverrideFields: {
          set: ["ISSUER", "PRODUCT_TYPE", "RATE_TERMS", "PURCHASE_DATE", "MATURITY_DATE"],
        },
        overrideProductName: null,
      },
    });
    await db!.pluggyInvestment.update({
      where: { id: investmentId },
      data: { name: "CDB MAIS RECENTE DA INSTITUIÇÃO" },
    });

    await reconcilePluggyInvestmentsForUser(userId);

    const holding = await db!.assetHolding.findUniqueOrThrow({ where: { id: holdingId } });
    expect(holding.productName).toBe("CDB MAIS RECENTE DA INSTITUIÇÃO");
    expect(holding.issuer).toBe("Banco Pine S.A.");
    expect(holding.rateValue?.toString()).toBe("14.85");
  });
});
