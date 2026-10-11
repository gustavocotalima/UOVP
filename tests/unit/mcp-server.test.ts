import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServer, handleMcpRequest, limitMcpUser, REPORTING_RULES } from "@/features/mcp/server";
import type { McpContext } from "@/features/mcp/types";

const mocks = vi.hoisted(() => ({
  summary: vi.fn(), account: vi.fn(), failure: vi.fn(), holding: vi.fn(),
  audit: vi.fn(), rate: vi.fn(), search: vi.fn(), fetch: vi.fn(),
}));

vi.mock("@/lib/auth-security", () => ({ consumeAuthRateLimit: mocks.rate }));
vi.mock("@/features/mcp/audit", () => ({ auditMcpCall: mocks.audit }));
vi.mock("@/features/mcp/finance-tools", async () => {
  const { z } = await import("zod");
  return { financeTools: [
    { name: "get_financial_summary", title: "Financial summary", description: "Read financial totals", scope: "finance:read", inputSchema: { year: z.number().int().min(2000).max(2200) }, outputSchema: { total: z.string() }, execute: mocks.summary },
    { name: "list_accounts", title: "Accounts", description: "Read balances", scope: "accounts:read", inputSchema: {}, outputSchema: { nativeBalance: z.string() }, execute: mocks.account },
    { name: "get_transaction", title: "Transaction", description: "Read one transaction", scope: "transactions:read", inputSchema: { transactionId: z.string().min(1) }, execute: mocks.failure },
  ] };
});
vi.mock("@/features/mcp/portfolio-tools", async () => {
  const { z } = await import("zod");
  return { portfolioTools: [{ name: "get_holding_details", title: "Holding", description: "Read one position", scope: "portfolio:read", inputSchema: { holdingId: z.string().min(1) }, outputSchema: { quantity: z.string() }, execute: mocks.holding }] };
});
vi.mock("@/features/mcp/discovery", () => ({
  searchMcpDocuments: mocks.search, fetchMcpDocument: mocks.fetch,
  discoveryScopes: ["finance:read", "accounts:read", "transactions:read", "portfolio:read", "balance-sheet:read"],
}));

const context: McpContext = {
  userId: "authorized-user", clientId: "test-client", grantId: "test-grant",
  scopes: ["finance:read"], timeZone: "America/Sao_Paulo",
};

async function withClient<T>(callback: (client: Client) => Promise<T>, owner = context) {
  const server = createMcpServer(owner);
  const client = new Client({ name: "mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await callback(client); }
  finally { await client.close(); await server.close(); }
}

function post(body: Record<string, unknown>) {
  return new Request("https://uovp.example.com/api/mcp", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.summary.mockResolvedValue({ total: "123.45" });
  mocks.account.mockResolvedValue({ nativeBalance: "548.15" });
  mocks.holding.mockResolvedValue({ quantity: "92" });
  mocks.failure.mockRejectedValue(new Error("postgres://SECRET_PASSWORD; BinanceSecret=super-secret; raw SQL payload"));
  mocks.audit.mockResolvedValue(undefined);
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.search.mockResolvedValue({ results: [{ id: "summary:2026-10", title: "Summary", url: "https://uovp.example.com/home" }] });
  mocks.fetch.mockResolvedValue({ id: "summary:2026-10", title: "Summary", text: "{}", url: "https://uovp.example.com/home" });
});

describe("MCP protocol and read-only tool server", () => {
  it("initializes through the real Streamable HTTP transport with reporting instructions", async () => {
    const body = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } };
    const response = await handleMcpRequest(post(body), context, body);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "uovp", version: "1.0.0" }, instructions: REPORTING_RULES } });
    expect(json.result.capabilities).toHaveProperty("tools");
    expect(response.headers.has("mcp-session-id")).toBe(false);
  });

  it("supports stateless HTTP tool listing and calls across separate server instances", async () => {
    const listBody = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
    const listResponse = await handleMcpRequest(post(listBody), context, listBody);
    expect(listResponse.status).toBe(200);
    const listing = await listResponse.json();
    expect(listing.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["get_financial_summary", "search", "fetch"]);
    const callBody = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_financial_summary", arguments: { year: 2026 } } };
    const callResponse = await handleMcpRequest(post(callBody), context, callBody);
    expect(callResponse.status).toBe(200);
    const call = await callResponse.json();
    expect(call.result.structuredContent).toMatchObject({ data: { total: "123.45" }, context: { readOnly: true } });
    expect(mocks.summary).toHaveBeenCalledWith(context, { year: 2026 });
  });

  it("exposes only scope-authorized analytics plus read-only search/fetch", async () => {
    await withClient(async (client) => {
      const response = await client.listTools();
      const names = response.tools.map((tool) => tool.name);
      expect(names).toEqual(["get_financial_summary", "search", "fetch"]);
      expect(names).not.toContain("list_accounts");
      expect(names).not.toContain("get_holding_details");
      expect(names.some((name) => /create|update|delete|execute|sync|transfer|trade/.test(name))).toBe(false);
      for (const tool of response.tools) {
        expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      }
      expect(response.tools[0]._meta).toEqual({ securitySchemes: [{ type: "oauth2", scopes: ["finance:read"] }] });
    });
  });

  it("rejects attempts to supply a different userId through the strict input schema", async () => {
    await withClient(async (client) => {
      const response = await client.callTool({ name: "get_financial_summary", arguments: { year: 2026, userId: "other-user" } });
      expect(response.isError).toBe(true);
      expect(mocks.summary).not.toHaveBeenCalled();
    });
  });

  it("returns schema-defined structured content with trustworthy read context and audits success", async () => {
    await withClient(async (client) => {
      const list = await client.listTools();
      expect(list.tools[0].outputSchema).toHaveProperty("properties.data");
      const response = await client.callTool({ name: "get_financial_summary", arguments: { year: 2026 } });
      expect(response.isError).toBeFalsy();
      expect(response.structuredContent).toMatchObject({ data: { total: "123.45" }, context: { timeZone: "America/Sao_Paulo", readOnly: true, retrievedAt: expect.any(String) } });
      expect(mocks.summary).toHaveBeenCalledWith(context, { year: 2026 });
      expect(mocks.audit).toHaveBeenCalledWith(context, "get_financial_summary", "SUCCESS", expect.any(Number));
    });
  });

  it("sanitizes internal errors without returning database credentials or provider secrets", async () => {
    await withClient(async (client) => {
      const response = await client.callTool({ name: "get_transaction", arguments: { transactionId: "owned-id" } });
      expect(response.isError).toBe(true);
      const text = JSON.stringify(response);
      expect(text).toContain("READ_FAILED");
      expect(text).not.toContain("SECRET_PASSWORD");
      expect(text).not.toContain("super-secret");
      expect(text).not.toContain("raw SQL");
      expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: context.userId }), "get_transaction", "FAILED", expect.any(Number));
    }, { ...context, scopes: ["transactions:read"] });
  });

  it("bounds structured results before returning excessive payloads", async () => {
    mocks.summary.mockResolvedValue({ total: "x".repeat(300_000) });
    await withClient(async (client) => {
      const response = await client.callTool({ name: "get_financial_summary", arguments: { year: 2026 } });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response)).toContain("TOO_LARGE");
      expect(JSON.stringify(response).length).toBeLessThan(1_000);
      expect(mocks.audit).toHaveBeenCalledWith(context, "get_financial_summary", "TOO_LARGE", expect.any(Number));
    });
  });

  it("serves accounting rules as a static resource without accessing financial data", async () => {
    await withClient(async (client) => {
      const response = await client.readResource({ uri: "uovp://reporting-rules" });
      expect(response.contents).toEqual([expect.objectContaining({ uri: "uovp://reporting-rules", text: REPORTING_RULES, mimeType: "text/plain" })]);
      expect(mocks.summary).not.toHaveBeenCalled();
      expect(mocks.account).not.toHaveBeenCalled();
    });
  });

  it("audits discovery calls and passes the authenticated context to the implementation", async () => {
    await withClient(async (client) => {
      const response = await client.callTool({ name: "search", arguments: { query: "2026-10" } });
      expect(response.structuredContent).toMatchObject({ results: [{ id: "summary:2026-10" }] });
      expect(mocks.search).toHaveBeenCalledWith(context, { query: "2026-10" });
      expect(mocks.audit).toHaveBeenCalledWith(context, "search", "SUCCESS", expect.any(Number));
    });
  });

  it("enforces per-user and per-client limits independently", async () => {
    await limitMcpUser(context);
    expect(mocks.rate).toHaveBeenCalledWith(expect.objectContaining({ scope: "mcp-user", identifier: context.userId }));
    expect(mocks.rate).toHaveBeenCalledWith(expect.objectContaining({ scope: "mcp-client", identifier: `${context.userId}:${context.clientId}` }));
    mocks.rate.mockResolvedValue({ allowed: false });
    await expect(limitMcpUser(context)).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });
});
