import { Prisma } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext, McpScope } from "@/features/mcp/types";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  db: {
    financeTransaction: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    financialAccount: { findMany: vi.fn() },
  },
}));
vi.mock("@/features/mcp/query", () => ({ readAnalysis: mocks.read }));
vi.mock("@/features/mcp/config", () => ({ mcpOrigin: () => "https://uovp.example.com" }));
vi.mock("@/features/mcp/portfolio-tools", () => ({ portfolioTools: [] }));

import { fetchMcpDocument, searchMcpDocuments } from "@/features/mcp/discovery";

const context: McpContext = {
  userId: "user-a", clientId: "client", grantId: "grant", timeZone: "America/Sao_Paulo", scopes: [],
};

describe("financial summary discovery uses the actual tool scope checks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.read.mockImplementation((_context, callback) => callback(mocks.db));
    mocks.db.financeTransaction.groupBy.mockResolvedValue([]);
    mocks.db.financeTransaction.count.mockResolvedValue(0);
    mocks.db.financeTransaction.findMany.mockResolvedValue([]);
    mocks.db.financialAccount.findMany.mockResolvedValue([{
      type: "BANK_ACCOUNT", balanceBrl: new Prisma.Decimal("321.45"),
      investmentLink: { enabled: true, assetHoldingId: "private-holding" },
    }]);
  });

  it.each<{
    scopes: McpScope[]; summaryAllowed: boolean; balancesAllowed: boolean;
  }>([
    { scopes: ["finance:read"], summaryAllowed: true, balancesAllowed: false },
    { scopes: ["accounts:read"], summaryAllowed: false, balancesAllowed: true },
    { scopes: ["finance:read", "accounts:read"], summaryAllowed: true, balancesAllowed: true },
    { scopes: [], summaryAllowed: false, balancesAllowed: false },
  ])("applies $scopes to search and fetched summary data", async ({ scopes, summaryAllowed, balancesAllowed }) => {
    const scopedContext = { ...context, scopes };
    const search = await searchMcpDocuments(scopedContext, { query: "2026-10" });
    expect(search.results.map((document) => document.id)).toEqual(summaryAllowed ? ["summary:2026-10"] : []);
    mocks.read.mockClear();
    if (!summaryAllowed) {
      await expect(fetchMcpDocument(scopedContext, { id: "summary:2026-10" })).rejects.toMatchObject({
        code: "insufficient_scope", status: 403,
      });
      expect(mocks.read).not.toHaveBeenCalled();
      expect(mocks.db.financialAccount.findMany).not.toHaveBeenCalled();
      return;
    }
    const document = await fetchMcpDocument(scopedContext, { id: "summary:2026-10" });
    const output = JSON.parse(document.text);
    expect(output.data).toMatchObject({
      currentAccountTotals: balancesAllowed ? { bankBalance: "321.45" } : null, complete: true,
    });
    expect(mocks.db.financialAccount.findMany).toHaveBeenCalledTimes(balancesAllowed ? 1 : 0);
    if (!balancesAllowed) {
      expect(output.warnings).toEqual([]);
      expect(document.text).not.toContain("321.45");
      expect(document.text).not.toContain("ACCOUNT_BALANCE");
    }
  });
});
