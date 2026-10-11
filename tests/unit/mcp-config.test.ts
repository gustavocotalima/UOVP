import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { mcpOAuthClient: { findUnique: vi.fn(), upsert: vi.fn() } } }));

import {
  assertMcpOrigin, mcpConfigured, mcpOrigin, mcpResource, parseScopes,
  redirectMatches, signingKeys, validateRedirectUri,
} from "@/features/mcp/config";
import { isTrustedClientMetadataUrl } from "@/features/mcp/clients";
import { authorizationMetadata, resourceMetadata } from "@/features/mcp/metadata";
import { redactAnalysisText } from "@/features/mcp/privacy";
import { MCP_SCOPES } from "@/features/mcp/types";
import { safeLoginCallback } from "@/lib/auth-callback";

const oldKey = Buffer.alloc(32, 1).toString("base64url");
const newKey = Buffer.alloc(32, 2).toString("base64url");

describe("MCP configuration and authorization metadata", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_URL", "https://uovp.example");
    vi.stubEnv("MCP_OAUTH_SIGNING_KEYS", `v1:${oldKey},v2:${newKey}`);
    vi.stubEnv("MCP_OAUTH_ACTIVE_KEY", "v2");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("normalizes permission whitespace and removes duplicates without broadening access", () => {
    expect(parseScopes(" accounts:read\ttransactions:read accounts:read ")).toEqual(["accounts:read", "transactions:read"]);
    expect(parseScopes(["portfolio:read", "portfolio:read"])).toEqual(["portfolio:read"]);
    expect(parseScopes([...MCP_SCOPES])).toEqual([...MCP_SCOPES]);
  });

  it.each(["", "  ", "finance:write", "accounts:read user:admin", "*"])("rejects empty or unknown scopes: %s", (value) => {
    expect(() => parseScopes(value)).toThrow(/permissions/);
  });

  it("accepts exact HTTPS redirects and native loopback callbacks", () => {
    expect(validateRedirectUri("https://agent.example/callback?client=uovp")).toBe("https://agent.example/callback?client=uovp");
    expect(validateRedirectUri("http://127.0.0.1:49152/callback")).toBe("http://127.0.0.1:49152/callback");
    expect(redirectMatches("http://127.0.0.1/callback", "http://127.0.0.1:49152/callback")).toBe(true);
    expect(redirectMatches("http://127.0.0.1:4321/callback", "http://127.0.0.1:5432/callback")).toBe(true);
  });

  it("does not relax HTTPS callbacks or the native callback host/path/query", () => {
    const exact = "https://agent.example/callback?client=uovp";
    expect(redirectMatches(exact, exact)).toBe(true);
    for (const uri of ["https://agent.example:444/callback?client=uovp", "https://agent.example/callback/other?client=uovp", "https://agent.example/callback?client=other", "http://agent.example/callback?client=uovp"]) {
      expect(redirectMatches(exact, uri)).toBe(false);
    }
    for (const uri of ["http://localhost:49152/callback", "http://127.0.0.2:49152/callback", "http://127.0.0.1:49152/callback/other", "http://127.0.0.1:49152/callback?other=1"]) {
      expect(redirectMatches("http://127.0.0.1/callback", uri)).toBe(false);
    }
  });

  it.each([
    "not-a-url", "javascript:alert(1)", "http://agent.example/callback",
    "http://localhost:3000/callback", "https://user:secret@agent.example/callback",
    "https://agent.example/callback#fragment",
  ])("rejects insecure or malformed redirects: %s", (value) => {
    expect(() => validateRedirectUri(value)).toThrow();
  });

  it("rejects oversized callback URLs", () => {
    expect(() => validateRedirectUri(`https://agent.example/callback?x=${"x".repeat(2048)}`)).toThrow();
  });

  it("rejects callback wildcards instead of treating them as exact registration", () => {
    expect(() => validateRedirectUri("https://*.agent.example/callback")).toThrow();
  });

  it.each([
    "https://chatgpt.com/oauth/client.json",
    "https://chatgpt.com/oauth/callback_ID-123/client.json",
    "https://chatgpt.com/oauth/codex/client.json",
    "https://chatgpt.com/oauth/codex/callback_ID-123/client.json",
  ])("allows only supported OpenAI CIMD paths: %s", (url) => {
    expect(isTrustedClientMetadataUrl(url)).toBe(true);
  });

  it.each([
    "http://chatgpt.com/oauth/client.json", "https://chatgpt.com.evil.example/oauth/client.json",
    "https://127.0.0.1/oauth/client.json", "https://10.0.0.1/oauth/client.json",
    "https://[::1]/oauth/client.json", "https://169.254.169.254/latest/meta-data/",
    "https://user@chatgpt.com/oauth/client.json", "https://chatgpt.com:444/oauth/client.json",
    "https://chatgpt.com/oauth/client.json?redirect=private", "https://chatgpt.com/oauth/client.json#fragment",
    "https://chatgpt.com/api/private.json", "https://chatgpt.com/oauth/client.json/other",
    "https://chatgpt.com/oauth/%63lient.json", "not-a-url",
  ])("rejects private hosts, credentials and unapproved CIMD paths: %s", (url) => {
    expect(isTrustedClientMetadataUrl(url)).toBe(false);
  });

  it("retains old signing keys while selecting the new active key", () => {
    const configured = signingKeys();
    expect(configured.active).toBe("v2");
    expect(Buffer.from(configured.keys.get("v1")!).toString("base64url")).toBe(oldKey);
    expect(Buffer.from(configured.keys.get("v2")!).toString("base64url")).toBe(newKey);
    expect(mcpConfigured()).toBe(true);
    vi.stubEnv("MCP_OAUTH_ACTIVE_KEY", "v1");
    expect(signingKeys().active).toBe("v1");
  });

  it.each([
    "", `v1:${oldKey},v1:${newKey}`, `invalid.id:${oldKey}`,
    `v1:${Buffer.alloc(31).toString("base64url")}`, `v1:${Buffer.alloc(33).toString("base64url")}`,
    `v1:${"*".repeat(43)}`, `v1:${oldKey}:extra`,
  ])("rejects absent, malformed or duplicate signing keys: %s", (value) => {
    vi.stubEnv("MCP_OAUTH_SIGNING_KEYS", value);
    expect(() => signingKeys()).toThrow();
    expect(mcpConfigured()).toBe(false);
  });

  it("rejects an absent active key or an active identifier outside the keyring", () => {
    vi.stubEnv("MCP_OAUTH_ACTIVE_KEY", "");
    expect(() => signingKeys()).toThrow();
    vi.stubEnv("MCP_OAUTH_ACTIVE_KEY", "unknown");
    expect(() => signingKeys()).toThrow();
  });

  it("binds discovery, issuer, resource and endpoints to the canonical HTTPS origin", () => {
    vi.stubEnv("AUTH_URL", "https://uovp.example/some/path");
    expect(mcpOrigin()).toBe("https://uovp.example");
    expect(mcpResource()).toBe("https://uovp.example/api/mcp");
    expect(resourceMetadata()).toEqual({
      resource: "https://uovp.example/api/mcp", authorization_servers: ["https://uovp.example"],
      scopes_supported: [...MCP_SCOPES], bearer_methods_supported: ["header"], resource_name: "UOVP read-only financial analysis",
    });
    expect(authorizationMetadata()).toMatchObject({
      issuer: "https://uovp.example", authorization_endpoint: "https://uovp.example/mcp/authorize",
      token_endpoint: "https://uovp.example/api/mcp/oauth/token", revocation_endpoint: "https://uovp.example/api/mcp/oauth/revoke",
      token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"], scopes_supported: [...MCP_SCOPES],
      client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true,
    });
    expect(authorizationMetadata()).not.toHaveProperty("registration_endpoint");
  });

  it("permits loopback HTTP in development but not at production runtime", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_URL", "http://localhost:3100");
    expect(mcpOrigin()).toBe("http://localhost:3100");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => mcpOrigin()).toThrow(/secure/);
    expect(mcpConfigured()).toBe(false);
    vi.stubEnv("AUTH_URL", "https://user:secret@uovp.example");
    expect(() => mcpOrigin()).toThrow();
  });

  it("allows canonical/browser-client Origins or no Origin, without accepting spoofed hosts", () => {
    for (const origin of [undefined, "https://uovp.example", "https://chatgpt.com"]) {
      expect(() => assertMcpOrigin(new Request("https://uovp.example/api/mcp", { headers: origin ? { origin } : {} }))).not.toThrow();
    }
    for (const origin of ["null", "http://uovp.example", "https://uovp.example.evil", "https://attacker.example"]) {
      expect(() => assertMcpOrigin(new Request("https://uovp.example/api/mcp", { headers: { origin, "x-forwarded-host": "uovp.example" } }))).toThrow(/Origin/);
    }
  });
});

describe("MCP consent login callbacks and financial label redaction", () => {
  it("preserves only a local MCP consent path with its OAuth query", () => {
    const callback = "/mcp/authorize?client_id=client&resource=https%3A%2F%2Fuovp.example%2Fapi%2Fmcp";
    expect(safeLoginCallback(callback)).toBe(callback);
    expect(safeLoginCallback(`${callback}#discarded`)).toBe(callback);
  });

  it.each([
    undefined, null, 123, {}, "https://attacker.example/mcp/authorize", "//attacker.example/mcp/authorize",
    "/\\attacker.example/mcp/authorize", "/mcp/authorize\nLocation: https://attacker.example",
    "/mcp/authorize\r", "/home", "/mcp/authorize/other", "/mcp/authorize/",
  ])("does not introduce an open login redirect: %s", (value) => {
    expect(safeLoginCallback(value)).toBe("/home");
  });

  it("rejects an oversized login callback", () => {
    expect(safeLoginCallback(`/mcp/authorize?x=${"x".repeat(8192)}`)).toBe("/home");
  });

  it("redacts formatted and unformatted CPF-like identifiers before limiting text", () => {
    expect(redactAnalysisText("Transferência 123.456.789-01 para 12345678901")).toBe("Transferência [CPF] para [identifier]");
    expect(redactAnalysisText("123.456.789-01 ajuste", 10)).toBe("[CPF] ajus");
    expect(redactAnalysisText("BOLT US$ 1,74", 500)).toBe("BOLT US$ 1,74");
    for (const value of [null, undefined, ""]) expect(redactAnalysisText(value)).toBeNull();
  });
});
