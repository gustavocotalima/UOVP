import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  loadEnvFile: vi.fn(),
  createPrismaClient: vi.fn(),
  backfill: vi.fn().mockResolvedValue(undefined),
  client: {
    fixedIncomeFamily: { upsert: vi.fn().mockResolvedValue(undefined) },
    assetCatalogItem: { upsert: vi.fn().mockResolvedValue(undefined) },
    investorProfilePreset: { upsert: vi.fn().mockResolvedValue(undefined) },
    $transaction: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("node:fs", () => ({ existsSync: mocks.existsSync }));
vi.mock("node:process", () => ({ loadEnvFile: mocks.loadEnvFile }));
vi.mock("@/lib/prisma-client", () => ({ createPrismaClient: mocks.createPrismaClient }));
vi.mock("@/features/portfolio/question-provisioning", () => ({
  synchronizeGlobalQuestionTemplates: vi.fn(),
  backfillUserDiagramQuestions: mocks.backfill,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", undefined);
  mocks.existsSync.mockReturnValue(true);
  mocks.loadEnvFile.mockImplementation(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/from-env-file");
  });
  mocks.createPrismaClient.mockImplementation(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
    return mocks.client;
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("seed environment initialization", () => {
  it("loads .env before creating the client when DATABASE_URL is not exported", async () => {
    await import("@/prisma/seed");
    await vi.waitFor(() => expect(mocks.client.$disconnect).toHaveBeenCalled());

    expect(mocks.loadEnvFile).toHaveBeenCalledWith(".env");
    expect(mocks.loadEnvFile.mock.invocationCallOrder[0]).toBeLessThan(mocks.createPrismaClient.mock.invocationCallOrder[0]);
    expect(process.env.DATABASE_URL).toBe("postgresql://test:test@localhost/from-env-file");
    expect(mocks.client.fixedIncomeFamily.upsert).toHaveBeenCalled();
    expect(mocks.backfill).toHaveBeenCalledWith(mocks.client);
  });

  it("preserves an exported DATABASE_URL without reading a local .env", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/exported");

    await import("@/prisma/seed");
    await vi.waitFor(() => expect(mocks.client.$disconnect).toHaveBeenCalled());

    expect(mocks.loadEnvFile).not.toHaveBeenCalled();
    expect(process.env.DATABASE_URL).toBe("postgresql://test:test@localhost/exported");
  });

  it("keeps the missing-configuration error when neither source is available", async () => {
    mocks.existsSync.mockReturnValue(false);

    await expect(import("@/prisma/seed")).rejects.toThrow("DATABASE_URL is required.");

    expect(mocks.loadEnvFile).not.toHaveBeenCalled();
    expect(mocks.client.fixedIncomeFamily.upsert).not.toHaveBeenCalled();
  });
});
