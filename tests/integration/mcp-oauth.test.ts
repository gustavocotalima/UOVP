import { createHash, randomBytes, randomUUID } from "node:crypto";
import { decodeJwt, decodeProtectedHeader, SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { McpScope } from "@/features/mcp/types";

const mocks = vi.hoisted(() => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireUserId: mocks.requireUserId }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://uovp.test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-security", () => ({ consumeAuthRateLimit: async () => ({ allowed: true }) }));

import { authenticateMcpRequest } from "@/features/mcp/auth";
import { createMcpAuthorization, exchangeMcpToken, revokeMcpToken, tokenHash } from "@/features/mcp/oauth";
import { revokeMcpGrantAction, setMcpEnabledAction } from "@/features/mcp/actions";
import { mcpResource } from "@/features/mcp/config";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const redirectUri = "http://127.0.0.1:4444/callback";
const testSigningKey = Buffer.alloc(32, 7);
const originalKeyConfiguration = `integration:${testSigningKey.toString("base64url")}`;

suite("MCP OAuth authorization, PKCE, rotation and revocation", () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  let userId = "";
  let otherUserId = "";
  let clientId = "";
  let otherClientId = "";

  const challenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
  const request = (scopes: McpScope[] = ["finance:read", "accounts:read"], verifier = randomBytes(32).toString("base64url"), client = clientId) => ({
    verifier,
    query: {
      response_type: "code", client_id: client, redirect_uri: redirectUri,
      scope: scopes.join(" "), state: randomUUID(), resource: mcpResource(),
      code_challenge: challenge(verifier), code_challenge_method: "S256",
    },
  });

  async function authorization(scopes: McpScope[] = ["finance:read", "accounts:read"], approvedScopes = scopes) {
    const input = request(scopes);
    const response = await createMcpAuthorization(userId, input.query, approvedScopes, true);
    const url = new URL(response.redirectUrl);
    expect(url.searchParams.get("state")).toBe(input.query.state);
    expect(url.searchParams.get("iss")).toBe("https://uovp.test");
    const code = url.searchParams.get("code");
    expect(code).toBeTruthy();
    return { ...input, code: code! };
  }

  async function exchange(input: Awaited<ReturnType<typeof authorization>>, extra: Record<string, string> = {}) {
    return exchangeMcpToken({
      grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri,
      code: input.code, code_verifier: input.verifier, resource: mcpResource(), ...extra,
    });
  }

  async function connected(scopes: McpScope[] = ["finance:read", "accounts:read"]) {
    const input = await authorization(scopes);
    const result = await exchange(input);
    expect(result.replay).toBe(false);
    const body = result.body as { access_token: string; refresh_token: string; scope: string; token_type: string; expires_in: number };
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
    return { input, body };
  }

  function bearer(accessToken: string) {
    return new Request(mcpResource(), { headers: { authorization: `Bearer ${accessToken}` } });
  }

  beforeAll(async () => {
    vi.stubEnv("AUTH_URL", "https://uovp.test");
    // Independent, deterministic test material only; never reads production keys.
    vi.stubEnv("MCP_OAUTH_SIGNING_KEYS", originalKeyConfiguration);
    vi.stubEnv("MCP_OAUTH_ACTIVE_KEY", "integration");
    const [user, other] = await Promise.all([
      prisma.user.create({ data: { email: `mcp-oauth-${suffix}@example.com`, mcpEnabled: true } }),
      prisma.user.create({ data: { email: `mcp-oauth-other-${suffix}@example.com`, mcpEnabled: true } }),
    ]);
    userId = user.id;
    otherUserId = other.id;
    clientId = randomUUID();
    otherClientId = randomUUID();
    await prisma.mcpOAuthClient.createMany({ data: [
      { id: clientId, name: "Integration test client", ownerId: userId, redirectUris: [redirectUri] },
      { id: otherClientId, name: "Other user's client", ownerId: otherUserId, redirectUris: [redirectUri] },
    ] });
  });

  beforeEach(async () => {
    vi.stubEnv("MCP_OAUTH_SIGNING_KEYS", originalKeyConfiguration);
    vi.stubEnv("MCP_OAUTH_ACTIVE_KEY", "integration");
    mocks.requireUserId.mockResolvedValue(userId);
    await prisma.user.updateMany({ where: { id: { in: [userId, otherUserId] } }, data: { mcpEnabled: true } });
  });

  afterAll(async () => {
    if (userId || otherUserId) await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId].filter(Boolean) } } });
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("exchanges a real PKCE code for a usable resource-bound bearer", async () => {
    const { input, body } = await connected();
    expect(body.token_type.toLowerCase()).toBe("bearer");
    expect(body.scope.split(" ")).toEqual(["finance:read", "accounts:read"]);
    const authenticated = await authenticateMcpRequest(bearer(body.access_token));
    expect(authenticated).toMatchObject({ userId, clientId, scopes: ["finance:read", "accounts:read"] });
    const code = await prisma.mcpOAuthCode.findUniqueOrThrow({ where: { codeHash: tokenHash(input.code) } });
    expect(code.consumedAt).not.toBeNull();
    expect(code.codeHash).not.toBe(input.code);
    const token = await prisma.mcpOAuthToken.findFirstOrThrow({ where: { grantId: authenticated.grantId } });
    expect(token.refreshHash).toBe(tokenHash(body.refresh_token));
    expect(JSON.stringify(token)).not.toContain(body.refresh_token);
  });

  it("rejects a wrong PKCE verifier without consuming the valid code", async () => {
    const input = await authorization();
    await expect(exchange(input, { code_verifier: randomBytes(32).toString("base64url") })).rejects.toThrow();
    const code = await prisma.mcpOAuthCode.findUniqueOrThrow({ where: { codeHash: tokenHash(input.code) } });
    expect(code.consumedAt).toBeNull();
    const result = await exchange(input);
    expect(result.status).toBe(200);
  });

  it("permits narrower consent but rejects scope escalation", async () => {
    const input = await authorization(["finance:read", "transactions:read"], ["finance:read"]);
    const result = await exchange(input);
    const body = result.body as { access_token: string; scope: string; refresh_token: string };
    expect(body.scope).toBe("finance:read");
    expect((await authenticateMcpRequest(bearer(body.access_token))).scopes).toEqual(["finance:read"]);
    await expect(exchangeMcpToken({ grant_type: "refresh_token", client_id: clientId, refresh_token: body.refresh_token, resource: mcpResource(), scope: "finance:read transactions:read" })).rejects.toThrow();
    const fresh = request(["finance:read"]);
    await expect(createMcpAuthorization(userId, fresh.query, ["portfolio:read"], true)).rejects.toThrow(/permissions/);
  });

  it("rotates refresh tokens and revokes the entire family after replay", async () => {
    const { body } = await connected(["finance:read"]);
    const refreshed = await exchangeMcpToken({ grant_type: "refresh_token", client_id: clientId, refresh_token: body.refresh_token, resource: mcpResource() });
    const next = refreshed.body as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(body.refresh_token);
    await expect(authenticateMcpRequest(bearer(body.access_token))).rejects.toThrow(/revoked/);
    const context = await authenticateMcpRequest(bearer(next.access_token));
    await expect(exchangeMcpToken({ grant_type: "refresh_token", client_id: clientId, refresh_token: body.refresh_token, resource: mcpResource() })).rejects.toThrow(/already used/);
    await expect(authenticateMcpRequest(bearer(next.access_token))).rejects.toThrow(/revoked/);
    const family = await prisma.mcpOAuthToken.findMany({ where: { grantId: context.grantId } });
    expect(family).toHaveLength(2);
    expect(family.every((token) => token.revokedAt !== null)).toBe(true);
    await expect(exchangeMcpToken({ grant_type: "refresh_token", client_id: clientId, refresh_token: next.refresh_token, resource: mcpResource() })).rejects.toThrow();
  });

  it("replayed authorization codes invalidate their issued tokens", async () => {
    const { input, body } = await connected(["finance:read"]);
    await expect(exchange(input)).rejects.toThrow(/already used/);
    await expect(authenticateMcpRequest(bearer(body.access_token))).rejects.toThrow(/revoked/);
  });

  it("rejects a different resource or different client's exchange", async () => {
    const input = await authorization();
    await expect(exchange(input, { resource: "https://other.test/api/mcp" })).rejects.toThrow(/different resource/);
    await expect(exchange(input, { client_id: otherClientId })).rejects.toThrow(/credential/);
    expect((await exchange(input)).status).toBe(200);
  });

  it("rejects expired codes and leaves no successful token", async () => {
    const input = await authorization();
    const code = await prisma.mcpOAuthCode.update({ where: { codeHash: tokenHash(input.code) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(exchange(input)).rejects.toThrow();
    expect(await prisma.mcpOAuthToken.count({ where: { grantId: code.grantId } })).toBe(0);
  });

  it("revoked grants immediately reject access and refresh", async () => {
    const { body } = await connected(["finance:read"]);
    const authenticated = await authenticateMcpRequest(bearer(body.access_token));
    await revokeMcpGrantAction(authenticated.grantId);
    await expect(authenticateMcpRequest(bearer(body.access_token))).rejects.toThrow(/revoked/);
    await expect(exchangeMcpToken({ grant_type: "refresh_token", client_id: clientId, refresh_token: body.refresh_token, resource: mcpResource() })).rejects.toThrow();
  });

  it("one user cannot revoke another user's grant through settings", async () => {
    const { body } = await connected(["finance:read"]);
    const authenticated = await authenticateMcpRequest(bearer(body.access_token));
    mocks.requireUserId.mockResolvedValue(otherUserId);
    const settings = await revokeMcpGrantAction(authenticated.grantId);
    expect(settings.grants.some((grant) => grant.id === authenticated.grantId)).toBe(false);
    const grant = await prisma.mcpOAuthGrant.findUniqueOrThrow({ where: { id: authenticated.grantId } });
    expect(grant.revokedAt).toBeNull();
    expect((await authenticateMcpRequest(bearer(body.access_token))).userId).toBe(userId);
  });

  it("does not allow authorization using another user's private client", async () => {
    const input = request(["finance:read"], randomBytes(32).toString("base64url"), otherClientId);
    await expect(createMcpAuthorization(userId, input.query, ["finance:read"], true)).rejects.toThrow();
  });

  it("disabling MCP revokes grants and does not silently revive them when enabled", async () => {
    const { body } = await connected(["finance:read"]);
    await setMcpEnabledAction(false);
    await expect(authenticateMcpRequest(bearer(body.access_token))).rejects.toThrow(/revoked/);
    await expect(exchangeMcpToken({ grant_type: "refresh_token", client_id: clientId, refresh_token: body.refresh_token, resource: mcpResource() })).rejects.toThrow();
    await setMcpEnabledAction(true);
    await expect(authenticateMcpRequest(bearer(body.access_token))).rejects.toThrow(/revoked/);
  });

  it("denied consent returns state without creating a grant", async () => {
    const input = request();
    const before = await prisma.mcpOAuthGrant.count({ where: { userId, clientId } });
    const response = await createMcpAuthorization(userId, input.query, [], false);
    const url = new URL(response.redirectUrl);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe(input.query.state);
    expect(await prisma.mcpOAuthGrant.count({ where: { userId, clientId } })).toBe(before);
  });

  it("client-scoped revocation cannot target a different client's token", async () => {
    const { body } = await connected(["finance:read"]);
    await revokeMcpToken({ client_id: otherClientId, token: body.refresh_token });
    await expect(authenticateMcpRequest(bearer(body.access_token))).resolves.toMatchObject({ userId });
    await revokeMcpToken({ client_id: clientId, token: body.refresh_token });
    await expect(authenticateMcpRequest(bearer(body.access_token))).rejects.toThrow(/revoked/);
  });

  it("serializes concurrent duplicate code exchanges and revokes the issued token on replay", async () => {
    const input = await authorization(["finance:read"]);
    const results = await Promise.allSettled([exchange(input), exchange(input)]);
    const successes = results.filter((result) => result.status === "fulfilled");
    const failures = results.filter((result) => result.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatchObject({ code: "invalid_grant" });
    const issued = successes[0].value.body as { access_token: string; refresh_token: string };
    await expect(authenticateMcpRequest(bearer(issued.access_token))).rejects.toThrow(/revoked/);
    const stored = await prisma.mcpOAuthCode.findUniqueOrThrow({ where: { codeHash: tokenHash(input.code) }, include: { tokens: true } });
    expect(stored.consumedAt).not.toBeNull();
    expect(stored.tokens).toHaveLength(1);
    expect(stored.tokens[0].revokedAt).not.toBeNull();
  });

  it("serializes concurrent refreshes and revokes the rotated family after duplicate use", async () => {
    const { body } = await connected(["finance:read"]);
    const context = await authenticateMcpRequest(bearer(body.access_token));
    const refreshBody = { grant_type: "refresh_token", client_id: clientId, refresh_token: body.refresh_token, resource: mcpResource() };
    const results = await Promise.allSettled([exchangeMcpToken(refreshBody), exchangeMcpToken(refreshBody)]);
    const successes = results.filter((result) => result.status === "fulfilled");
    const failures = results.filter((result) => result.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatchObject({ code: "invalid_grant" });
    const issued = successes[0].value.body as { access_token: string; refresh_token: string };
    await expect(authenticateMcpRequest(bearer(issued.access_token))).rejects.toThrow(/revoked/);
    const family = await prisma.mcpOAuthToken.findMany({ where: { grantId: context.grantId } });
    expect(family).toHaveLength(2);
    expect(new Set(family.map((token) => token.familyId)).size).toBe(1);
    expect(family.every((token) => token.revokedAt !== null)).toBe(true);
  });

  it("manual grant revocation racing code exchange leaves no usable bearer", async () => {
    const input = await authorization(["finance:read"]);
    const stored = await prisma.mcpOAuthCode.findUniqueOrThrow({ where: { codeHash: tokenHash(input.code) } });
    const [exchanged, revoked] = await Promise.allSettled([exchange(input), revokeMcpGrantAction(stored.grantId)]);
    expect(revoked.status).toBe("fulfilled");
    if (exchanged.status === "fulfilled") {
      const issued = exchanged.value.body as { access_token: string; refresh_token: string };
      await expect(authenticateMcpRequest(bearer(issued.access_token))).rejects.toThrow(/revoked/);
      await expect(exchangeMcpToken({ grant_type: "refresh_token", client_id: clientId, refresh_token: issued.refresh_token, resource: mcpResource() })).rejects.toThrow();
    } else {
      expect(exchanged.reason).toBeInstanceOf(Error);
    }
    const grant = await prisma.mcpOAuthGrant.findUniqueOrThrow({ where: { id: stored.grantId } });
    expect(grant.revokedAt).not.toBeNull();
  });

  it("manual grant revocation racing refresh leaves neither old nor new tokens usable", async () => {
    const { body } = await connected(["finance:read"]);
    const context = await authenticateMcpRequest(bearer(body.access_token));
    const [refreshed, revoked] = await Promise.allSettled([
      exchangeMcpToken({ grant_type: "refresh_token", client_id: clientId, refresh_token: body.refresh_token, resource: mcpResource() }),
      revokeMcpGrantAction(context.grantId),
    ]);
    expect(revoked.status).toBe("fulfilled");
    await expect(authenticateMcpRequest(bearer(body.access_token))).rejects.toThrow(/revoked/);
    if (refreshed.status === "fulfilled") {
      const issued = refreshed.value.body as { access_token: string; refresh_token: string };
      await expect(authenticateMcpRequest(bearer(issued.access_token))).rejects.toThrow(/revoked/);
    } else {
      expect(refreshed.reason).toBeInstanceOf(Error);
    }
    const grant = await prisma.mcpOAuthGrant.findUniqueOrThrow({ where: { id: context.grantId } });
    expect(grant.revokedAt).not.toBeNull();
  });

  it("supports signing-key rotation and rejects removed key IDs", async () => {
    const { body: previous } = await connected(["finance:read"]);
    expect(decodeProtectedHeader(previous.access_token).kid).toBe("integration");
    const nextKey = Buffer.alloc(32, 9);
    const nextKeyConfiguration = `rotated:${nextKey.toString("base64url")}`;
    vi.stubEnv("MCP_OAUTH_SIGNING_KEYS", `${originalKeyConfiguration},${nextKeyConfiguration}`);
    vi.stubEnv("MCP_OAUTH_ACTIVE_KEY", "rotated");
    const { body: current } = await connected(["finance:read"]);
    expect(decodeProtectedHeader(current.access_token).kid).toBe("rotated");
    await expect(authenticateMcpRequest(bearer(previous.access_token))).resolves.toMatchObject({ userId });
    await expect(authenticateMcpRequest(bearer(current.access_token))).resolves.toMatchObject({ userId });
    vi.stubEnv("MCP_OAUTH_SIGNING_KEYS", nextKeyConfiguration);
    await expect(authenticateMcpRequest(bearer(previous.access_token))).rejects.toThrow(/revoked/);
    await expect(authenticateMcpRequest(bearer(current.access_token))).resolves.toMatchObject({ userId });
  });

  it("rejects correctly signed tokens with wrong audience, issuer, or unknown key ID", async () => {
    const { body } = await connected(["finance:read"]);
    const claims = decodeJwt(body.access_token);
    const wrongAudience = await new SignJWT({ ...claims, aud: "https://other.test/api/mcp" }).setProtectedHeader({ alg: "HS256", kid: "integration" }).sign(testSigningKey);
    const wrongIssuer = await new SignJWT({ ...claims, iss: "https://other.test" }).setProtectedHeader({ alg: "HS256", kid: "integration" }).sign(testSigningKey);
    const unknownKid = await new SignJWT(claims).setProtectedHeader({ alg: "HS256", kid: "unknown" }).sign(testSigningKey);
    for (const token of [wrongAudience, wrongIssuer, unknownKid]) {
      await expect(authenticateMcpRequest(bearer(token))).rejects.toThrow(/revoked/);
    }
    await expect(authenticateMcpRequest(bearer(body.access_token))).resolves.toMatchObject({ userId });
  });

  it("checks signed scopes and subject against the persisted grant", async () => {
    const { body } = await connected(["finance:read"]);
    const claims = decodeJwt(body.access_token);
    const escalatedScope = await new SignJWT({ ...claims, scope: "finance:read portfolio:read" }).setProtectedHeader({ alg: "HS256", kid: "integration" }).sign(testSigningKey);
    const wrongSubject = await new SignJWT({ ...claims, sub: otherUserId }).setProtectedHeader({ alg: "HS256", kid: "integration" }).sign(testSigningKey);
    for (const token of [escalatedScope, wrongSubject]) {
      await expect(authenticateMcpRequest(bearer(token))).rejects.toThrow(/revoked/);
    }
    await expect(authenticateMcpRequest(bearer(body.access_token))).resolves.toMatchObject({ userId, scopes: ["finance:read"] });
  });
});
