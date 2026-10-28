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
function holding({ quantity = 125, amountOriginal = null, currency = "BRL" }: { quantity?: number; amountOriginal?: number | null; currency?: string } = {}) {
  return {
    quantity: new Decimal(quantity), investedValue: null, investedValueCurrency: null, positionSource: "PLUGGY",
    pluggyDiagramLink: { pluggyInvestmentDbId: "investment-a", investment: {
      amountOriginal: amountOriginal === null ? null : new Decimal(amountOriginal),
      currencyCode: currency,
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
      page: 2, pageSize: 25, total: 80, averagePricePaid: "24.98", averagePriceCoverage: 0.8, averagePriceCurrency: "BRL",
      transactions: [],
    });
    expect(mocks.holding).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: holdingId, asset: { portfolio: { userId: "user-a" } } },
      select: expect.objectContaining({ pluggyDiagramLink: { select: {
        pluggyInvestmentDbId: true,
        contributionBatches: { where: { state: { in: ["WAITING", "CONFLICT"] } }, select: { id: true }, take: 1 },
        investment: { select: {
          amountOriginal: true, currencyCode: true, purchaseQuantityTotal: true, purchaseCostTotal: true, purchaseSummaryVersion: true,
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

  it("retorna a moeda do custo USD tanto pelo valor original quanto pelo resumo de compras", async () => {
    mocks.holding.mockResolvedValue(holding({ quantity: 2, amountOriginal: 100, currency: "USD" }));
    expect(await (await request()).json()).toMatchObject({ averagePricePaid: "50", averagePriceCurrency: "USD" });
    mocks.holding.mockResolvedValue(holding({ quantity: 125, currency: "USD" }));
    expect(await (await request()).json()).toMatchObject({ averagePricePaid: "24.98", averagePriceCurrency: "USD" });
  });

  it("retorna movimentações na moeda do investimento, independente da cotação da holding", async () => {
    mocks.holding.mockResolvedValue({ ...holding({ quantity: 2, amountOriginal: 100, currency: "USD" }), currency: "BRL" });
    mocks.movements.mockResolvedValue([{
      id: "movement", description: "Compra", type: "BUY", movementType: null,
      quantity: new Decimal(2), value: new Decimal(50), amount: new Decimal(100), netAmount: null, agreedRate: null,
      date: new Date("2026-01-01T00:00:00Z"), tradeDate: null,
    }]);
    expect(await (await request()).json()).toMatchObject({
      averagePriceCurrency: "USD", transactions: [{ currencyCode: "USD", value: "50", amount: "100" }],
    });
  });
});
