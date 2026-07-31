import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    asset: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    assetHolding: {
      create: vi.fn(),
    },
  };
  return {
    tx,
    revalidatePath: vi.fn(),
    requireUserId: vi.fn(),
    ensurePortfolio: vi.fn(),
    fixedIncomeFamilyFindUnique: vi.fn(),
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
  assertUserOperationRateLimit: vi.fn(),
  withUserOperationLease: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    fixedIncomeFamily: {
      findUnique: mocks.fixedIncomeFamilyFindUnique,
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

import { saveFixedIncomeGroupAction } from "@/features/portfolio/actions";

describe("validação de grupos de renda fixa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("user-a");
    mocks.ensurePortfolio.mockResolvedValue({ id: "portfolio-a" });
    mocks.fixedIncomeFamilyFindUnique.mockResolvedValue({
      code: "BANK_DEPOSITS_FGC",
      name: "Depósitos bancários com FGC",
      shortCode: "CDB/RDB/LC",
    });
  });

  it("não sobrescreve outro grupo com a mesma família e indexação", async () => {
    mocks.tx.asset.findFirst.mockResolvedValue({ id: "existing-group" });

    await expect(saveFixedIncomeGroupAction({
      familyCode: "BANK_DEPOSITS_FGC",
      indexation: "PRE_FIXED",
      investmentClass: "FIXED_INCOME",
      score: 7,
    })).rejects.toThrow(
      "Já existe o grupo Depósitos bancários com FGC · Pré-fixado nesta carteira. Edite o grupo existente.",
    );

    expect(mocks.tx.asset.update).not.toHaveBeenCalled();
    expect(mocks.tx.asset.create).not.toHaveBeenCalled();
  });
});
