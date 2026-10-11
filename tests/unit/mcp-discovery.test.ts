import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchMcpDocuments, fetchMcpDocument } from "@/features/mcp/discovery";
import type { McpContext } from "@/features/mcp/types";

const database = vi.hoisted(() => ({
  financeTransaction: { findMany: vi.fn(), findFirst: vi.fn() },
  assetHolding: { findMany: vi.fn(), findFirst: vi.fn() },
}));
const helpers = vi.hoisted(() => ({ summary: vi.fn(), transaction: vi.fn(), network: vi.fn() }));

vi.mock("@/features/mcp/query", () => ({
  readAnalysis: (_context: McpContext, read: (db: Prisma.TransactionClient) => Promise<unknown>) => read(database as unknown as Prisma.TransactionClient),
}));
vi.mock("@/features/mcp/config", () => ({ mcpOrigin: () => "https://uovp.example.com" }));
vi.mock("@/features/mcp/finance-tools", () => ({
  financeTools: [
    { name: "get_financial_summary", scope: "finance:read", execute: helpers.summary },
    { name: "get_transaction", scope: "transactions:read", execute: helpers.transaction },
  ],
}));

const context: McpContext = {
  userId: "current-user", clientId: "client", grantId: "grant",
  scopes: ["finance:read", "transactions:read", "portfolio:read"], timeZone: "America/Sao_Paulo",
};

function ownedHolding() {
  const decimal = (value: string | number) => new Prisma.Decimal(value);
  const date = new Date("2026-10-11T00:00:00.000Z");
  return {
    id: "owned-holding", assetId: "owned-asset", catalogItemId: null, customTypeName: null,
    issuer: "Coca Cola", productName: "KO", pricingSource: "YAHOO", positionSource: "MANUAL",
    currency: "USD", quantity: decimal(1), unitPrice: decimal(100), fxRateToBrl: decimal(5), fxUpdatedAt: date,
    investedValue: null, currentValue: null, providerCurrentValue: null, includedInTotals: true,
    supersededAt: null, fractional: true, rateConvention: null, benchmark: null, rateValue: null,
    purchaseDate: null, maturityDate: null, priceUpdatedAt: date, updatedAt: date,
    catalogItem: null, pluggyDiagramLink: null, binanceWalletAsset: null,
    asset: { id: "owned-asset", ticker: "KO", name: "Coca Cola", instrumentType: "STOCK", investmentClass: "INTERNATIONAL_STOCKS", marketRegion: "INTERNATIONAL", fixedIncomeFamilyCode: null, indexation: null, score: 8, updatedAt: date },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  database.financeTransaction.findMany.mockResolvedValue([]);
  database.assetHolding.findMany.mockResolvedValue([]);
  database.assetHolding.findFirst.mockResolvedValue(null);
  helpers.summary.mockResolvedValue({ data: { period: { year: 2026, month: 10 }, netResult: "123.45" } });
  helpers.transaction.mockResolvedValue({ data: { transaction: { id: "owned-transaction", reportingAmountBrl: "10" } } });
  helpers.network.mockRejectedValue(new Error("Discovery may not request arbitrary URLs"));
  vi.stubGlobal("fetch", helpers.network);
});

describe("MCP document discovery", () => {
  it("searches only the connected user's active, undeleted, nonremoved transactions", async () => {
    database.financeTransaction.findMany.mockResolvedValue([{ id: "transaction-1", description: "BOLT 123.456.789-01" }]);
    const result = await searchMcpDocuments({ ...context, scopes: ["transactions:read"] }, { query: "BOLT" });
    expect(database.financeTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: context.userId, deleted: false, account: { userId: context.userId, active: true },
        description: { contains: "BOLT", mode: "insensitive" },
        OR: [{ providerLifecycle: null }, { providerLifecycle: { not: "REMOVED" } }],
      }),
      take: 10, select: { id: true, description: true },
    }));
    expect(result.results).toEqual([{ id: "transaction:transaction-1", title: "BOLT [CPF]", url: "https://uovp.example.com/transacoes" }]);
    expect(database.assetHolding.findMany).not.toHaveBeenCalled();
    expect(helpers.network).not.toHaveBeenCalled();
  });

  it("searches only owned holdings and adds portfolio/month documents only for approved scopes", async () => {
    database.assetHolding.findMany.mockResolvedValue([{ id: "holding-1", productName: "KO", asset: { ticker: "KO", name: "Coca Cola" } }]);
    const result = await searchMcpDocuments(context, { query: "KO 2026-10" });
    expect(result.results.map((document) => document.id)).toEqual(["summary:2026-10", "portfolio:summary", "holding:holding-1"]);
    expect(database.assetHolding.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { asset: { portfolio: { userId: context.userId }, OR: [{ ticker: { contains: "KO 2026-10", mode: "insensitive" } }, { name: { contains: "KO 2026-10", mode: "insensitive" } }] } }, take: 10 }));
    const restricted = await searchMcpDocuments({ ...context, scopes: ["accounts:read"] }, { query: "2026-10" });
    expect(restricted.results).toEqual([]);
  });

  it("bounds result counts and validates search input strictly", async () => {
    database.financeTransaction.findMany.mockResolvedValue(Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}`, description: "Transaction" })));
    const result = await searchMcpDocuments(context, { query: "2026-10" });
    expect(result.results).toHaveLength(22);
    await expect(searchMcpDocuments(context, { query: "KO", userId: "other-user" })).rejects.toThrow();
    await expect(searchMcpDocuments(context, { query: "x".repeat(201) })).rejects.toThrow();
  });

  it("refuses fetch documents without their matching permission before querying", async () => {
    await expect(fetchMcpDocument({ ...context, scopes: ["accounts:read"] }, { id: "holding:owned-holding" })).rejects.toMatchObject({ code: "insufficient_scope", status: 403 });
    await expect(fetchMcpDocument({ ...context, scopes: ["portfolio:read"] }, { id: "transaction:owned-id" })).rejects.toMatchObject({ code: "insufficient_scope", status: 403 });
    await expect(fetchMcpDocument({ ...context, scopes: ["transactions:read"] }, { id: "summary:2026-10" })).rejects.toMatchObject({ code: "insufficient_scope", status: 403 });
    expect(database.assetHolding.findFirst).not.toHaveBeenCalled();
    expect(helpers.transaction).not.toHaveBeenCalled();
    expect(helpers.summary).not.toHaveBeenCalled();
  });

  it("fetches holdings through the actual ownership-filtered portfolio tool", async () => {
    database.assetHolding.findFirst.mockResolvedValue(ownedHolding());
    const result = await fetchMcpDocument(context, { id: "holding:owned-holding" });
    expect(database.assetHolding.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "owned-holding", asset: { portfolio: { userId: context.userId } } } }));
    expect(result).toMatchObject({ id: "holding:owned-holding", title: "Investment position", url: "https://uovp.example.com/carteira" });
    const document = JSON.parse(result.text);
    expect(document.holding).toMatchObject({ quantity: "1", nativeCurrentValue: "100", currentValueBrl: "500", currency: "USD" });
    expect(helpers.network).not.toHaveBeenCalled();
  });

  it("rejects a guessed foreign holding ID even when it did not originate in search", async () => {
    database.assetHolding.findFirst.mockResolvedValue(null);
    await expect(fetchMcpDocument(context, { id: "holding:foreign-holding" })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(database.assetHolding.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign-holding", asset: { portfolio: { userId: context.userId } } } }));
  });

  it("fetches summaries and transactions using the authenticated context, not caller-supplied user IDs", async () => {
    await fetchMcpDocument(context, { id: "summary:2026-10" });
    expect(helpers.summary).toHaveBeenCalledWith(context, { year: 2026, month: 10 });
    await fetchMcpDocument(context, { id: "transaction:owned-transaction" });
    expect(helpers.transaction).toHaveBeenCalledWith(context, { transactionId: "owned-transaction" });
    await expect(fetchMcpDocument(context, { id: "transaction:owned-transaction", userId: "other-user" })).rejects.toThrow();
  });

  it("does not accept arbitrary URLs or unknown document kinds", async () => {
    for (const id of ["https://evil.example.com/secret", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "account:unknown", "summary:2026-13"]) {
      await expect(fetchMcpDocument(context, { id })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    }
    expect(helpers.network).not.toHaveBeenCalled();
    expect(helpers.summary).not.toHaveBeenCalled();
    expect(helpers.transaction).not.toHaveBeenCalled();
    expect(database.assetHolding.findFirst).not.toHaveBeenCalled();
  });
});
