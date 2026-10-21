import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanupMcpOAuthForUser, MCP_OAUTH_RETENTION_MS } from "@/features/mcp/oauth-retention";
import { createMcpAuthorization, exchangeMcpToken, tokenHash } from "@/features/mcp/oauth";
import { authenticateMcpRequest } from "@/features/mcp/auth";
import { mcpResource } from "@/features/mcp/config";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const callback = "http://127.0.0.1:4444/callback";
const now = new Date();
const old = new Date(now.getTime() - 3 * MCP_OAUTH_RETENTION_MS);
const future = new Date(now.getTime() + MCP_OAUTH_RETENTION_MS);

suite("retenção OAuth sem perder evidências de replay", () => {
  const users: string[] = [];
  const clients: string[] = [];

  async function fixture() {
    const user = await prisma.user.create({ data: { email: `oauth-retention-${randomUUID()}@example.com`, mcpEnabled: true } });
    users.push(user.id);
    const client = await prisma.mcpOAuthClient.create({ data: { id: randomUUID(), name: "Public retention client", redirectUris: [callback], ownerId: null } });
    clients.push(client.id);
    return { user, client };
  }

  async function oldFamily(userId: string, clientId: string, size = 1) {
    const grant = await prisma.mcpOAuthGrant.create({
      data: { userId, clientId, scopes: ["finance:read"], resource: mcpResource(), createdAt: old, revokedAt: old },
    });
    const code = await prisma.mcpOAuthCode.create({ data: {
      grantId: grant.id, codeHash: tokenHash(randomUUID()), codeChallenge: "x".repeat(43), redirectUri: callback,
      expiresAt: old, consumedAt: old,
    } });
    const familyId = randomUUID();
    const tokens = await Promise.all(Array.from({ length: size }, () => prisma.mcpOAuthToken.create({ data: {
      id: randomUUID(), grantId: grant.id, familyId, authCodeHash: code.codeHash, scopes: ["finance:read"],
      refreshHash: tokenHash(randomUUID()), accessExpiresAt: old, refreshExpiresAt: old, revokedAt: old, createdAt: old,
    } })));
    return { grant, code, familyId, tokens };
  }

  async function connected(userId: string, clientId: string) {
    const verifier = randomBytes(32).toString("base64url");
    const query = {
      response_type: "code", client_id: clientId, redirect_uri: callback, scope: "finance:read", state: randomUUID(),
      resource: mcpResource(), code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    };
    const authorization = await createMcpAuthorization(userId, query, ["finance:read"], true);
    const code = new URL(authorization.redirectUrl).searchParams.get("code")!;
    const input = { grant_type: "authorization_code", client_id: clientId, redirect_uri: callback, code, code_verifier: verifier, resource: mcpResource() };
    const response = await exchangeMcpToken(input);
    return { input, code, body: response.body as { access_token: string; refresh_token: string } };
  }

  function bearer(accessToken: string) {
    return new Request(mcpResource(), { headers: { authorization: `Bearer ${accessToken}` } });
  }

  beforeAll(() => {
    vi.stubEnv("AUTH_URL", "https://uovp.test");
    vi.stubEnv("MCP_OAUTH_SIGNING_KEYS", `retention:${Buffer.alloc(32, 6).toString("base64url")}`);
    vi.stubEnv("MCP_OAUTH_ACTIVE_KEY", "retention");
  });

  afterAll(async () => {
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
    if (clients.length) await prisma.mcpOAuthClient.deleteMany({ where: { id: { in: clients } } });
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it("remove expirados em lotes idempotentes sem apagar clientes públicos nem outro usuário", async () => {
    const f = await fixture();
    const other = await fixture();
    const expired = await oldFamily(f.user.id, f.client.id, 5);
    const untouched = await oldFamily(other.user.id, other.client.id);
    expect(await cleanupMcpOAuthForUser(f.user.id, { now, batchSize: 2, apply: false })).toMatchObject({ tokens: 2, codes: 0, grants: 0 });
    expect(await prisma.mcpOAuthToken.count({ where: { grantId: expired.grant.id } })).toBe(5);
    expect(await cleanupMcpOAuthForUser(f.user.id, { now, batchSize: 2 })).toMatchObject({ tokens: 2, codes: 0, grants: 0, hasMore: true });
    expect(await cleanupMcpOAuthForUser(f.user.id, { now, batchSize: 2 })).toMatchObject({ tokens: 2, codes: 0, grants: 0 });
    expect(await cleanupMcpOAuthForUser(f.user.id, { now, batchSize: 2 })).toMatchObject({ tokens: 1, codes: 1, grants: 1 });
    expect(await cleanupMcpOAuthForUser(f.user.id, { now, batchSize: 2 })).toMatchObject({ tokens: 0, codes: 0, grants: 0 });
    expect(await prisma.mcpOAuthToken.count({ where: { grantId: untouched.grant.id } })).toBe(1);
    expect(await prisma.mcpOAuthClient.findUnique({ where: { id: f.client.id } })).not.toBeNull();
  });

  it("preserva ancestrais antigos enquanto a família possui um descendente utilizável", async () => {
    const f = await fixture();
    const family = await oldFamily(f.user.id, f.client.id);
    await prisma.mcpOAuthGrant.update({ where: { id: family.grant.id }, data: { revokedAt: null } });
    await prisma.mcpOAuthToken.create({ data: {
      id: randomUUID(), grantId: family.grant.id, familyId: family.familyId, authCodeHash: family.code.codeHash,
      scopes: ["finance:read"], accessExpiresAt: future, refreshExpiresAt: future, refreshHash: tokenHash(randomUUID()),
    } });
    expect(await cleanupMcpOAuthForUser(f.user.id, { now })).toMatchObject({ tokens: 0, codes: 0, grants: 0 });
    expect(await prisma.mcpOAuthToken.count({ where: { grantId: family.grant.id } })).toBe(2);
    expect(await prisma.mcpOAuthCode.findUnique({ where: { codeHash: family.code.codeHash } })).not.toBeNull();
    await prisma.mcpOAuthToken.updateMany({ where: { grantId: family.grant.id }, data: { revokedAt: now } });
    expect(await cleanupMcpOAuthForUser(f.user.id, { now })).toMatchObject({ tokens: 0, codes: 0, grants: 0 });
  });

  it("mantém código consumido e o replay ainda revoga o bearer após a limpeza", async () => {
    const f = await fixture();
    const active = await connected(f.user.id, f.client.id);
    await prisma.mcpOAuthCode.update({ where: { codeHash: tokenHash(active.code) }, data: { expiresAt: old, consumedAt: old } });
    expect(await cleanupMcpOAuthForUser(f.user.id, { now })).toMatchObject({ codes: 0 });
    await expect(authenticateMcpRequest(bearer(active.body.access_token))).resolves.toMatchObject({ userId: f.user.id });
    await expect(exchangeMcpToken(active.input)).rejects.toThrow("already used");
    await expect(authenticateMcpRequest(bearer(active.body.access_token))).rejects.toThrow("revoked");
  });

  it("mantém refresh ancestral e o replay revoga o descendente ativo após a limpeza", async () => {
    const f = await fixture();
    const active = await connected(f.user.id, f.client.id);
    const refreshed = await exchangeMcpToken({ grant_type: "refresh_token", client_id: f.client.id, resource: mcpResource(), refresh_token: active.body.refresh_token });
    const next = refreshed.body as { access_token: string; refresh_token: string };
    await prisma.mcpOAuthToken.update({
      where: { refreshHash: tokenHash(active.body.refresh_token) }, data: { accessExpiresAt: old, refreshExpiresAt: old, revokedAt: old },
    });
    expect(await cleanupMcpOAuthForUser(f.user.id, { now })).toMatchObject({ tokens: 0 });
    await expect(exchangeMcpToken({ grant_type: "refresh_token", client_id: f.client.id, resource: mcpResource(), refresh_token: active.body.refresh_token })).rejects.toThrow("already used");
    await expect(authenticateMcpRequest(bearer(next.access_token))).rejects.toThrow("revoked");
    expect((await prisma.mcpOAuthToken.findUniqueOrThrow({
      where: { refreshHash: tokenHash(active.body.refresh_token) },
    })).revokedAt).toEqual(old);
  });

  it("pula usuário ocupado e concorre com rotação sem apagar evidências", async () => {
    const f = await fixture();
    const active = await connected(f.user.id, f.client.id);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const continueWriter = new Promise<void>((resolve) => { release = resolve; });
    const writer = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mcp-user:${f.user.id}`}))`;
      entered();
      await continueWriter;
    });
    await started;
    try {
      expect(await cleanupMcpOAuthForUser(f.user.id, { now })).toMatchObject({ skipped: true, tokens: 0, codes: 0, grants: 0 });
    } finally { release(); }
    await writer;
    const [cleanup, refresh] = await Promise.all([
      cleanupMcpOAuthForUser(f.user.id, { now }),
      exchangeMcpToken({ grant_type: "refresh_token", client_id: f.client.id, resource: mcpResource(), refresh_token: active.body.refresh_token }),
    ]);
    expect(cleanup.tokens).toBe(0);
    const next = refresh.body as { access_token: string };
    await expect(authenticateMcpRequest(bearer(next.access_token))).resolves.toMatchObject({ userId: f.user.id });
    expect(await prisma.mcpOAuthToken.findUnique({ where: { refreshHash: tokenHash(active.body.refresh_token) } })).not.toBeNull();
  });
});
