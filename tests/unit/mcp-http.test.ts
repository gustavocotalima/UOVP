import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthException } from "@jmondi/oauth2-server";

const mocks = vi.hoisted(() => ({ consumeAuthRateLimit: vi.fn(), clientIpFromHeaders: vi.fn() }));
vi.mock("@/lib/auth-security", () => mocks);

import { boundedBody, limitMcpHttp, mcpHttpError, privateJson, uniqueParameters } from "@/features/mcp/http";
import { McpError } from "@/features/mcp/types";

function request(body?: BodyInit | null, headers?: HeadersInit) {
  return new Request("https://uovp.example/api/mcp", { method: "POST", body, headers });
}

describe("MCP private HTTP helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_URL", "https://uovp.example");
    mocks.clientIpFromHeaders.mockReturnValue(null);
    mocks.consumeAuthRateLimit.mockResolvedValue({ allowed: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("marks financial responses private even if caller-provided headers ask for public caching", async () => {
    const response = privateJson({ safe: true }, 201, { "Cache-Control": "public, max-age=60", "X-Test": "kept" });
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Test")).toBe("kept");
    expect(await response.json()).toEqual({ safe: true });
  });

  it("advertises resource discovery for unauthorized requests", async () => {
    const response = mcpHttpError(new McpError("invalid_token", "Access token is invalid.", 401));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer resource_metadata="https://uovp.example/.well-known/oauth-protected-resource/api/mcp"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid_token", error_description: "Access token is invalid." });
  });

  it("does not expose unknown exceptions or raw OAuth details", async () => {
    const hidden = await mcpHttpError(new Error("secret=private-token balance=999 CPF=123.456.789-01")).json();
    expect(hidden).toEqual({ error: "server_error", error_description: "UOVP could not complete this request." });
    const oauth = mcpHttpError(OAuthException.invalidGrant("secret=private-code"));
    expect(oauth.status).toBeGreaterThanOrEqual(400);
    const body = await oauth.json();
    expect(body.error).toBe("invalid_grant");
    expect(body.error_description).not.toContain("private-code");
    expect(body.error_description).toContain("PKCE");
  });

  it("reads empty bodies and measures the actual UTF-8 byte length", async () => {
    expect(await boundedBody(request())).toBe("");
    expect(await boundedBody(request("😊"), 4)).toBe("😊");
    await expect(boundedBody(request("😊"), 3)).rejects.toMatchObject({ code: "TOO_LARGE", status: 413 });
    expect(await boundedBody(request("1234", { "content-length": "4" }), 4)).toBe("1234");
  });

  it("rejects declared oversized bodies and undeclared bodies beyond the same limit", async () => {
    await expect(boundedBody(request("tiny", { "content-length": "65537" }))).rejects.toMatchObject({ code: "TOO_LARGE", status: 413 });
    await expect(boundedBody(request("x".repeat(65_537)))).rejects.toMatchObject({ code: "TOO_LARGE", status: 413 });
    await expect(boundedBody(request("abcdef", { "content-length": "1" }), 5)).rejects.toMatchObject({ status: 413 });
  });

  it("cancels an oversized streamed body and releases its reader", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("abcdef")); },
      cancel,
    });
    const streamed = new Request("https://uovp.example/api/mcp", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(boundedBody(streamed, 5)).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(streamed.body?.locked).toBe(false);
  });

  it("decodes unique form parameters and rejects duplicate security-critical fields", () => {
    expect(uniqueParameters(new URLSearchParams("resource=https%3A%2F%2Fuovp.example%2Fapi%2Fmcp&scope=accounts%3Aread+transactions%3Aread"))).toEqual({ resource: "https://uovp.example/api/mcp", scope: "accounts:read transactions:read" });
    for (const field of ["client_id", "resource", "code", "redirect_uri", "code_verifier", "scope"]) {
      expect(() => uniqueParameters(new URLSearchParams(`${field}=one&${field}=two`))).toThrow(/Duplicate/);
    }
  });

  it("does not let prototype-shaped keys disappear or bypass duplicate detection", () => {
    expect(() => uniqueParameters(new URLSearchParams("__proto__=one&__proto__=two"))).toThrow(/Duplicate/);
    const parameters = uniqueParameters(new URLSearchParams("constructor=one&toString=two"));
    expect(Object.hasOwn(parameters, "constructor")).toBe(true);
    expect(Object.hasOwn(parameters, "toString")).toBe(true);
  });

  it("rejects untrusted Origins before consuming a rate limit", async () => {
    await expect(limitMcpHttp(request(null, { origin: "https://attacker.example" }))).rejects.toMatchObject({ code: "FORBIDDEN_ORIGIN", status: 403 });
    expect(mocks.consumeAuthRateLimit).not.toHaveBeenCalled();
  });

  it("applies global and trusted-IP limits for accepted remote requests", async () => {
    mocks.clientIpFromHeaders.mockReturnValue("192.0.2.10");
    await limitMcpHttp(request());
    expect(mocks.consumeAuthRateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.consumeAuthRateLimit).toHaveBeenCalledWith(expect.objectContaining({ scope: "mcp-global", identifier: "application", limit: 1000, windowMs: 3_600_000 }));
    expect(mocks.consumeAuthRateLimit).toHaveBeenCalledWith(expect.objectContaining({ scope: "mcp-ip", identifier: "192.0.2.10", limit: 120, windowMs: 60_000 }));
  });

  it("returns a sanitized 429 when either rate bucket rejects the request", async () => {
    mocks.clientIpFromHeaders.mockReturnValue("192.0.2.10");
    mocks.consumeAuthRateLimit.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    let failure: unknown;
    try { await limitMcpHttp(request(null, { origin: "https://uovp.example" })); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "RATE_LIMITED", status: 429 });
    const response = mcpHttpError(failure);
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "RATE_LIMITED", error_description: "Too many requests. Try again shortly." });
  });
});
