import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { pluggyAccountSchema } from "@/features/open-finance/pluggy";
import { syncAccountInvestmentSnapshots } from "@/features/open-finance/sync";

const db = process.env.DATABASE_URL ? new PrismaClient() : null;
const suite = db ? describe : describe.skip;

suite("preservação das reservas com identidade ambígua", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("não sobrescreve nem poda o último snapshot completo e preserva os overrides", async () => {
    const user = await db!.user.create({ data: {
      email: `reserve-identity-${randomUUID()}@example.com`, portfolio: { create: {} },
    }, include: { portfolio: true } });
    userIds.push(user.id);
    const item = await db!.pluggyItem.create({ data: {
      userId: user.id, pluggyItemId: randomUUID(), connectorName: "Banco", status: "UPDATED",
    } });
    const account = await db!.pluggyAccount.create({ data: {
      pluggyItemDbId: item.id, pluggyAccountId: randomUUID(), name: "Conta", type: "BANK",
      subtype: "CHECKING_ACCOUNT", currencyCode: "BRL", balance: 500,
    } });
    const payload = (reservedBalances: Array<Record<string, unknown>>) => pluggyAccountSchema.parse({
      id: account.pluggyAccountId, type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta",
      currencyCode: "BRL", balance: 500, bankData: { hasReservedBalance: true, reservedBalances },
      updatedAt: "2026-10-21T12:00:00Z",
    });
    const write = (input: ReturnType<typeof payload>) => db!.$transaction((tx) =>
      syncAccountInvestmentSnapshots(tx, item.id, account.id, "Banco", input));
    expect(await write(payload([
      { name: "Reserva", availableAmounts: [{ amount: 100, currencyCode: "BRL" }] },
      { name: "Viagem", identification: "travel", availableAmounts: [{ amount: 300, currencyCode: "BRL" }] },
    ]))).toEqual({ syncedCount: 2, partial: false });
    const before = await db!.pluggyInvestment.findMany({ where: { pluggyAccountDbId: account.id }, orderBy: { id: "asc" } });
    const reserve = before.find((investment) => investment.name === "Reserva")!;
    const asset = await db!.asset.create({ data: {
      portfolioId: user.portfolio!.id, ticker: "RESERVE-TEST", name: "Reserva personalizada",
      investmentClass: "FIXED_INCOME", instrumentType: "FIXED_INCOME",
    } });
    const holding = await db!.assetHolding.create({ data: {
      assetId: asset.id, positionSource: "PLUGGY", pricingSource: "MANUAL", currency: "BRL",
      productName: "Nome editado", issuer: "Emissor editado", quantity: 1, unitPrice: 100,
    } });
    const link = await db!.pluggyInvestmentDiagramLink.create({ data: {
      userId: user.id, pluggyInvestmentDbId: reserve.id, assetHoldingId: holding.id,
      status: "MAPPED", classificationSource: "USER_OVERRIDE",
      metadataOverrideFields: ["PRODUCT_NAME", "PURCHASE_DATE"], overrideProductName: "Nome editado",
      overridePurchaseDate: new Date("2026-07-18T00:00:00Z"),
    } });

    expect(await write(payload([
      { name: "Reserva", availableAmounts: [{ amount: 200, currencyCode: "BRL" }] },
      { name: "RESÉRVA", availableAmounts: [{ amount: 400, currencyCode: "BRL" }] },
      { name: "Viagem", identification: "travel", availableAmounts: [{ amount: 900, currencyCode: "BRL" }] },
    ]))).toEqual({ syncedCount: 0, partial: true });
    expect(await db!.pluggyInvestment.findMany({ where: { pluggyAccountDbId: account.id }, orderBy: { id: "asc" } })).toEqual(before);
    expect(await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: link.id } })).toEqual(link);
    expect(await db!.assetHolding.findUniqueOrThrow({ where: { id: holding.id } })).toEqual(holding);

    // A later unambiguous snapshot converges using the original identities.
    expect(await write(payload([
      { name: "Viagem", identification: "travel", availableAmounts: [{ amount: 350, currencyCode: "BRL" }] },
      { name: "Reserva", availableAmounts: [{ amount: 150, currencyCode: "BRL" }] },
    ]))).toEqual({ syncedCount: 2, partial: false });
    const after = await db!.pluggyInvestment.findMany({ where: { pluggyAccountDbId: account.id }, orderBy: { id: "asc" } });
    expect(after.map((investment) => investment.id)).toEqual(before.map((investment) => investment.id));
    expect(after.find((investment) => investment.name === "Reserva")?.balance.toString()).toBe("150");
    expect(await db!.pluggyInvestmentDiagramLink.findUniqueOrThrow({ where: { id: link.id } })).toEqual(link);
  });
});
