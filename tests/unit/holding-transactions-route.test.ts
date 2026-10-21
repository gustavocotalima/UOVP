import Decimal from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ holding: vi.fn(), movements: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => "user-a" }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  assetHolding: { findFirst: mocks.holding },
  pluggyInvestmentTransaction: { findMany: mocks.movements, count: mocks.count },
} }));

import { GET } from "@/app/api/portfolio/holdings/[holdingId]/transactions/route";

const holdingId = "cm1holding00000000000000001";
function holding({ quantity = 125, amountOriginal = null }: { quantity?: number; amountOriginal?: number | null } = {}) {
  return {
    quantity: new Decimal(quantity), investedValue: null, positionSource: "PLUGGY",
    pluggyDiagramLink: { pluggyInvestmentDbId: "investment-a", investment: {
      amountOriginal: amountOriginal === null ? null : new Decimal(amountOriginal),
      purchaseQuantityTotal: new Decimal(100), purchaseCostTotal: new Decimal(2498), purchaseSummaryVersion: 1,
    } },
  };
}
function request(query = "page=2&pageSize=25") {
  return GET(new Request(`https://uovp.example/api/portfolio/holdings/${holdingId}/transactions?${query}`), {
    params: Promise.resolve({ holdingId }),
  });
}

describe("movimentações de posições com resumo de compras", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.holding.mockResolvedValue(holding());
    mocks.movements.mockResolvedValue([]);
    mocks.count.mockResolvedValue(80);
  });

  it("consulta somente a página e a contagem, preservando o contrato de preço e cobertura", async () => {
    const response = await request();
    expect(await response.json()).toEqual({
      page: 2, pageSize: 25, total: 80, averagePricePaid: "24.98", averagePriceCoverage: 0.8,
      transactions: [],
    });
    expect(mocks.holding).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: holdingId, asset: { portfolio: { userId: "user-a" } } },
      select: expect.objectContaining({ pluggyDiagramLink: { select: {
        pluggyInvestmentDbId: true,
        investment: { select: {
          amountOriginal: true, purchaseQuantityTotal: true, purchaseCostTotal: true, purchaseSummaryVersion: true,
        } },
      } } }),
    }));
    expect(mocks.movements).toHaveBeenCalledTimes(1);
    expect(mocks.movements).toHaveBeenCalledWith(expect.objectContaining({
      where: { pluggyInvestmentDbId: "investment-a" }, take: 25, skip: 25,
    }));
    expect(mocks.count).toHaveBeenCalledTimes(1);
    expect(mocks.count).toHaveBeenCalledWith({ where: { pluggyInvestmentDbId: "investment-a" } });
  });

  it.each([
    { quantity: 0, amountOriginal: null, price: null, coverage: 0 },
    { quantity: 10, amountOriginal: 850, price: "85", coverage: 1 },
    { quantity: 50, amountOriginal: null, price: "24.98", coverage: 1 },
  ])("mantém atalhos e quantidade efetiva sem ampliar a consulta: $quantity", async ({ quantity, amountOriginal, price, coverage }) => {
    mocks.holding.mockResolvedValue(holding({ quantity, amountOriginal }));
    expect(await (await request()).json()).toMatchObject({ averagePricePaid: price, averagePriceCoverage: coverage });
    expect(mocks.movements).toHaveBeenCalledTimes(1);
    expect(mocks.movements.mock.calls[0][0].take).toBe(25);
  });

  it("nega posições sem vínculo do usuário antes de consultar movimentos", async () => {
    mocks.holding.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.movements).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });
});
