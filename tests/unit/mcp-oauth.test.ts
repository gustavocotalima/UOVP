import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveMcpClient: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/features/mcp/clients", () => ({ resolveMcpClient: mocks.resolveMcpClient }));

import { authorizationQuerySchema, getMcpAuthorizationRequest } from "@/features/mcp/oauth";
import { MCP_SCOPES } from "@/features/mcp/types";

const clientId = "https://chatgpt.com/oauth/client.json";
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
const resource = "https://uovp.example/api/mcp";
const signingKey = Buffer.alloc(32, 9).toString("base64url");
const query = (): Record<string, string> => ({
  response_type: "code", client_id: clientId, redirect_uri: redirectUri,
  scope: MCP_SCOPES.join(" "), state: "oauth-test-state", resource,
  code_challenge: "a".repeat(43), code_challenge_method: "S256",
});

describe("MCP authorization query locale compatibility", () => {
  it("keeps ui_locales optional", () => {
    expect(authorizationQuerySchema.parse(query())).toEqual(query());
  });

  it.each(["pt-BR", "pt-BR en-US", "x".repeat(200)])("accepts a bounded string locale hint: %s", (ui_locales) => {
    expect(authorizationQuerySchema.parse({ ...query(), ui_locales })).toMatchObject({ ui_locales });
  });

  it.each(["x".repeat(201), ["pt-BR"], 123, null, { locale: "pt-BR" }])("rejects oversized or non-string locale hints: %j", (ui_locales) => {
    expect(authorizationQuerySchema.safeParse({ ...query(), ui_locales }).success).toBe(false);
  });

  it("does not allow other unknown authorization parameters", () => {
    expect(authorizationQuerySchema.safeParse({ ...query(), ui_locales: "pt-BR", unrecognized_parameter: "value" }).success).toBe(false);
  });

  it.each<[string, Record<string, string>]>([
    ["response type", { response_type: "token" }],
    ["empty client", { client_id: "" }],
    ["oversized client", { client_id: "x".repeat(2049) }],
    ["empty callback", { redirect_uri: "" }],
    ["oversized callback", { redirect_uri: "x".repeat(2049) }],
    ["empty scope", { scope: "" }],
    ["oversized scope", { scope: "x".repeat(301) }],
    ["empty state", { state: "" }],
    ["oversized state", { state: "x".repeat(1025) }],
    ["oversized resource", { resource: "x".repeat(2049) }],
    ["short PKCE challenge", { code_challenge: "a".repeat(42) }],
    ["long PKCE challenge", { code_challenge: "a".repeat(44) }],
    ["non-base64url PKCE challenge", { code_challenge: "+".repeat(43) }],
    ["plain PKCE", { code_challenge_method: "plain" }],
  ])("preserves validation of %s even with a locale hint", (_name, changes) => {
    expect(authorizationQuerySchema.safeParse({ ...query(), ...changes, ui_locales: "pt-BR" }).success).toBe(false);
  });
});

describe("MCP authorization request validation with locale hints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_URL", "https://uovp.example");
    vi.stubEnv("MCP_OAUTH_SIGNING_KEYS", `unit:${signingKey}`);
    vi.stubEnv("MCP_OAUTH_ACTIVE_KEY", "unit");
    mocks.resolveMcpClient.mockResolvedValue({ id: clientId, name: "ChatGPT", redirectUris: [redirectUri] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "pt-BR", "pt-BR en-US"])("accepts %s without adding locale data to the authorization grant", async (ui_locales) => {
    const input: Record<string, string> = { ...query(), ...(ui_locales === undefined ? {} : { ui_locales }) };
    const result = await getMcpAuthorizationRequest(input);
    expect(result).toEqual({
      clientId, clientName: "ChatGPT", redirectUri, scopes: [...MCP_SCOPES], resource,
      state: input.state, codeChallenge: input.code_challenge,
    });
    expect(mocks.resolveMcpClient).toHaveBeenCalledWith(clientId);
  });

  it.each<Record<string, string>>([
    { ui_locales: "x".repeat(201) },
    { ui_locales: "pt-BR", unrecognized_parameter: "value" },
    { ui_locales: "pt-BR", code_challenge_method: "plain" },
    { ui_locales: "pt-BR", code_challenge: "a".repeat(42) },
    { ui_locales: "pt-BR", state: "" },
  ])("rejects malformed parameters before resolving a client: %j", async (changes) => {
    await expect(getMcpAuthorizationRequest({ ...query(), ...changes })).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.resolveMcpClient).not.toHaveBeenCalled();
  });

  it.each(["response_type", "client_id", "redirect_uri", "scope", "state", "resource", "code_challenge", "code_challenge_method"])("still requires %s with a locale hint", async (field) => {
    const input: Record<string, string> = { ...query(), ui_locales: "pt-BR" };
    delete input[field];
    await expect(getMcpAuthorizationRequest(input)).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.resolveMcpClient).not.toHaveBeenCalled();
  });

  it("still rejects a different resource before resolving a client", async () => {
    await expect(getMcpAuthorizationRequest({ ...query(), ui_locales: "pt-BR", resource: "https://other.example/api/mcp" })).rejects.toMatchObject({ code: "invalid_target" });
    expect(mocks.resolveMcpClient).not.toHaveBeenCalled();
  });

  it.each(["http://chatgpt.com/connector_platform_oauth_redirect", "https://chatgpt.com/connector_platform_oauth_redirect#fragment", "https://user@chatgpt.com/connector_platform_oauth_redirect"])("still rejects unsafe callbacks: %s", async (redirect_uri) => {
    await expect(getMcpAuthorizationRequest({ ...query(), ui_locales: "pt-BR", redirect_uri })).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.resolveMcpClient).not.toHaveBeenCalled();
  });

  it("still requires the exact registered HTTPS callback", async () => {
    await expect(getMcpAuthorizationRequest({ ...query(), ui_locales: "pt-BR", redirect_uri: `${redirectUri}?other=1` })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it.each(["finance:write", "finance:read unknown:read", "   "])("still rejects unknown or empty scopes: %s", async (scope) => {
    await expect(getMcpAuthorizationRequest({ ...query(), ui_locales: "pt-BR", scope })).rejects.toMatchObject({ code: "invalid_scope" });
  });

  it("does not bypass missing signing-key configuration", async () => {
    vi.stubEnv("MCP_OAUTH_ACTIVE_KEY", "missing");
    await expect(getMcpAuthorizationRequest({ ...query(), ui_locales: "pt-BR" })).rejects.toMatchObject({ code: "SERVER_CONFIG" });
    expect(mocks.resolveMcpClient).not.toHaveBeenCalled();
  });
});
