import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    asset: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    assetHolding: {
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  };
  return {
    tx,
    revalidatePath: vi.fn(),
    requireUserId: vi.fn(),
    assertUserOperationRateLimit: vi.fn(),
    ensurePortfolio: vi.fn(),
    fixedIncomeFamilyCount: vi.fn(),
    assetHoldingFindMany: vi.fn(),
    bumpPortfolioAndInvalidateDrafts: vi.fn(),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/current-user", () => ({
  requireUserId: mocks.requireUserId,
}));

vi.mock("@/lib/operation-security", () => ({
  assertUserOperationRateLimit: mocks.assertUserOperationRateLimit,
  withUserOperationLease: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    fixedIncomeFamily: {
      count: mocks.fixedIncomeFamilyCount,
    },
    assetHolding: {
      findMany: mocks.assetHoldingFindMany,
    },
    $transaction: vi.fn((operation: (tx: typeof mocks.tx) => unknown) => operation(mocks.tx)),
  },
}));

vi.mock("@/features/portfolio/data", () => ({
  ensurePortfolio: mocks.ensurePortfolio,
  getPortfolioData: vi.fn(),
}));

vi.mock("@/features/portfolio/invalidation", () => ({
  bumpPortfolioAndInvalidateDrafts: mocks.bumpPortfolioAndInvalidateDrafts,
}));

import { saveAssetAction } from "@/features/portfolio/actions";

describe("edição da classificação de ativos Pluggy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("user-a");
    mocks.assertUserOperationRateLimit.mockResolvedValue(undefined);
    mocks.ensurePortfolio.mockResolvedValue({ id: "portfolio-a" });
    mocks.fixedIncomeFamilyCount.mockResolvedValue(1);
    mocks.assetHoldingFindMany.mockResolvedValue([
      {
        id: "holding-pluggy",
        positionSource: "PLUGGY",
      },
    ]);
    mocks.tx.asset.findFirst.mockResolvedValue({ id: "cmrzcyi3305pglw710ptyacct" });
    mocks.tx.asset.update.mockResolvedValue({ id: "cmrzcyi3305pglw710ptyacct" });
    mocks.tx.assetHolding.count.mockResolvedValue(1);
    mocks.bumpPortfolioAndInvalidateDrafts.mockResolvedValue(undefined);
  });

  it("converte Ação em ETF de Renda Fixa sem criar ou alterar a holding Pluggy", async () => {
    await expect(saveAssetAction({
      id: "cmrzcyi3305pglw710ptyacct",
      investmentClass: "FIXED_INCOME",
      instrumentType: "ETF",
      ticker: "BSLV39",
      name: "iShares Silver Trust",
      quantity: 5,
      unitPrice: 90,
      manualValue: null,
      currency: "BRL",
      fractional: false,
      score: -11,
      fixedIncomeFamilyCode: "PUBLIC_TREASURY",
      indexation: "OTHER",
      yahooReitConfirmed: false,
    })).resolves.toBeUndefined();

    expect(mocks.assetHoldingFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        positionSource: { in: ["MANUAL", "PLUGGY"] },
      }),
    }));
    expect(mocks.tx.asset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        instrumentType: "ETF",
        investmentClass: "FIXED_INCOME",
        fixedIncomeFamilyCode: "PUBLIC_TREASURY",
        indexation: "OTHER",
        instrumentSource: "USER_OVERRIDE",
        exposureSource: "USER_OVERRIDE",
        groupSource: "USER_OVERRIDE",
      }),
    }));
    expect(mocks.tx.assetHolding.update).not.toHaveBeenCalled();
    expect(mocks.tx.assetHolding.create).not.toHaveBeenCalled();
  });
});
