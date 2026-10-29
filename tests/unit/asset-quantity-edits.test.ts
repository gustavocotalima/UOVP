import { Prisma } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), resolve: vi.fn(),
  tx: { pluggyInvestmentDiagramLink: { findMany: vi.fn(), update: vi.fn() }, assetHolding: { update: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { pluggyInvestmentDiagramLink: { findMany: mocks.findMany } } }));
vi.mock("@/features/open-finance/investment-quantity-quote", async (original) => ({
  ...await original<typeof import("@/features/open-finance/investment-quantity-quote")>(),
  resolvePluggyQuantityQuote: mocks.resolve,
}));

import { applyAssetQuantityEdits, assetQuantityEditSchema, prepareAssetQuantityEdits, validateAssetQuantityEdits } from "@/features/open-finance/asset-quantity-edits";

function fixture() {
  return {
    id: "cmrzcyi3305pglw710ptyacct", userId: "user-a", status: "MAPPED",
    updatedAt: new Date("2026-10-14T12:00:00Z"), metadataOverrideFields: ["ISSUER"],
    contributionBatches: [],
    overrideQuantity: null as Prisma.Decimal | null,
    overrideQuantityProviderQuantity: null as Prisma.Decimal | null,
    overrideQuantityAcknowledgedAt: null as Date | null,
    investment: {
      quantity: new Prisma.Decimal(0), balance: new Prisma.Decimal(0), status: "TOTAL_WITHDRAWAL",
      providerAvailable: true, source: "INVESTMENTS_API", item: { userId: "user-a", status: "UPDATED", disconnectedAt: null },
    },
    holding: {
      id: "holding-a", assetId: "asset-a", positionSource: "PLUGGY", pricingSource: "BRAPI",
      unitPrice: new Prisma.Decimal(50), currency: "BRL", fxRateToBrl: null, fxUpdatedAt: null,
      priceUpdatedAt: new Date("2026-10-14T11:00:00Z"), fractional: false,
      asset: {
        id: "asset-a", ticker: "ITUB3", instrumentType: "STOCK", investmentClass: "BRAZILIAN_STOCKS",
        marketRegion: null, portfolio: { userId: "user-a" }, holdings: [],
      },
    },
  };
}

describe("quantidades temporárias no editor de ativo", () => {
  let link: ReturnType<typeof fixture>;
  const tx = mocks.tx as unknown as Prisma.TransactionClient;
  const signal = new AbortController().signal;
  const edit = (mode: "CUSTOM" | "PROVIDER" = "CUSTOM", value: number | null = 110) => assetQuantityEditSchema.parse({
    linkId: link.id, expectedUpdatedAt: link.updatedAt, expectedProviderQuantity: link.investment.quantity.toString(), mode, value,
  });
  beforeEach(() => {
    vi.clearAllMocks();
    link = fixture();
    mocks.findMany.mockImplementation(async () => [link]);
    mocks.tx.pluggyInvestmentDiagramLink.findMany.mockImplementation(async () => [link]);
    mocks.resolve.mockImplementation(async () => ({ ...link.holding }));
  });

  it("salva por posição, preserva outras correções e não altera o snapshot", async () => {
    const prepared = await prepareAssetQuantityEdits("user-a", link.holding.asset, [edit()], signal);
    const links = await validateAssetQuantityEdits(tx, "user-a", prepared);
    await applyAssetQuantityEdits(tx, prepared, links);
    const data = mocks.tx.pluggyInvestmentDiagramLink.update.mock.calls[0][0].data;
    expect(data.metadataOverrideFields.set).toEqual(["ISSUER", "QUANTITY"]);
    expect(data.overrideQuantity.toString()).toBe("110");
    expect(data.overrideQuantityProviderQuantity.toString()).toBe("0");
    expect(mocks.tx.assetHolding.update.mock.calls[0][0].data).toMatchObject({ quantity: new Prisma.Decimal(110), includedInTotals: true });
    expect(link.investment.quantity.toString()).toBe("0");
    expect(link.investment.balance.toString()).toBe("0");
  });

  it("permite zero sem consultar preços", async () => {
    const prepared = await prepareAssetQuantityEdits("user-a", link.holding.asset, [edit("CUSTOM", 0)], signal);
    await applyAssetQuantityEdits(tx, prepared, await validateAssetQuantityEdits(tx, "user-a", prepared));
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.tx.assetHolding.update.mock.calls[0][0].data.includedInTotals).toBe(false);
  });

  it("restaura o provedor sem remover o emissor personalizado", async () => {
    const prepared = await prepareAssetQuantityEdits("user-a", link.holding.asset, [edit("PROVIDER", null)], signal);
    await applyAssetQuantityEdits(tx, prepared, await validateAssetQuantityEdits(tx, "user-a", prepared));
    const data = mocks.tx.pluggyInvestmentDiagramLink.update.mock.calls[0][0].data;
    expect(data.metadataOverrideFields.set).toEqual(["ISSUER"]);
    expect(data.overrideQuantity).toBeNull();
    expect(data.overrideQuantityAcknowledgedAt).toBeNull();
    expect(mocks.tx.assetHolding.update.mock.calls[0][0].data).toMatchObject({ quantity: new Prisma.Decimal(0), includedInTotals: false });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it.each(["owner", "asset", "binance", "excluded", "unavailable"])("rejeita posição inválida: %s", async (state) => {
    const asset = { ...link.holding.asset };
    if (state === "owner") link.investment.item.userId = "user-b";
    if (state === "asset") link.holding.assetId = "asset-b";
    if (state === "binance") link.holding.positionSource = "BINANCE";
    if (state === "excluded") link.status = "EXCLUDED";
    if (state === "unavailable") link.investment.providerAvailable = false;
    await expect(prepareAssetQuantityEdits("user-a", asset, [edit()], signal)).rejects.toThrow();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.tx.assetHolding.update).not.toHaveBeenCalled();
  });

  it("revalida o snapshot depois da cotação e antes de qualquer escrita", async () => {
    const prepared = await prepareAssetQuantityEdits("user-a", link.holding.asset, [edit()], signal);
    link.investment.quantity = new Prisma.Decimal(120);
    await expect(validateAssetQuantityEdits(tx, "user-a", prepared)).rejects.toThrow("posição mudou");
    expect(mocks.tx.assetHolding.update).not.toHaveBeenCalled();
  });

  it("não mistura troca de classificação com quantidades", async () => {
    await expect(prepareAssetQuantityEdits("user-a", { ...link.holding.asset, investmentClass: "INTERNATIONAL_STOCKS" }, [edit()], signal)).rejects.toThrow("classificação");
  });

  it("rejeita frações nacionais mesmo com flag antiga e aceita ações internacionais", async () => {
    link.holding.fractional = true;
    await expect(prepareAssetQuantityEdits("user-a", link.holding.asset, [edit("CUSTOM", 0.5)], signal)).rejects.toThrow("inteiras");
    link.holding.pricingSource = "YAHOO";
    link.holding.asset.investmentClass = "INTERNATIONAL_STOCKS";
    link.holding.fractional = false;
    await expect(prepareAssetQuantityEdits("user-a", link.holding.asset, [edit("CUSTOM", 0.1234567891)], signal)).resolves.toBeDefined();
  });

  it("preserva uma cotação mais nova obtida enquanto o formulário era salvo", async () => {
    const prepared = await prepareAssetQuantityEdits("user-a", link.holding.asset, [edit()], signal);
    link.holding.unitPrice = new Prisma.Decimal(60);
    link.holding.priceUpdatedAt = new Date("2026-10-14T13:00:00Z");
    await applyAssetQuantityEdits(tx, prepared, await validateAssetQuantityEdits(tx, "user-a", prepared));
    expect(mocks.tx.assetHolding.update.mock.calls[0][0].data.unitPrice.toString()).toBe("60");
  });

  it("rejeita posições repetidas sem fazer consultas externas", async () => {
    await expect(prepareAssetQuantityEdits("user-a", link.holding.asset, [edit(), edit()], signal)).rejects.toThrow("repetida");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
