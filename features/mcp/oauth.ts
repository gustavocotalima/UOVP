import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  AuthorizationServer, DateInterval, JwtService, OAuthException, OAuthRequest,
  type OAuthAuthCode, type OAuthAuthCodeRepository, type OAuthClient,
  type OAuthClientRepository, type OAuthScopeRepository, type OAuthToken,
  type OAuthTokenRepository, type OAuthUserRepository,
} from "@jmondi/oauth2-server";
import { decodeProtectedHeader, jwtVerify } from "jose";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseScopes, mcpOrigin, mcpResource, redirectMatches, signingKeys, validateRedirectUri } from "./config";
import { resolveMcpClient } from "./clients";
import { opportunisticMcpOAuthCleanup } from "./oauth-retention";
import { McpError, MCP_SCOPES, type McpScope } from "./types";

export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const secretToken = () => randomBytes(32).toString("base64url");
const toClient = (client: { id: string; name: string; redirectUris: string[] }): OAuthClient => ({
  id: client.id, name: client.name, redirectUris: client.redirectUris, secret: null,
  allowedGrants: ["authorization_code", "refresh_token"], scopes: MCP_SCOPES.map((name) => ({ name })),
});

export class McpJwtService extends JwtService {
  constructor() { const { keys, active } = signingKeys(); super(Buffer.from(keys.get(active)!)); }
  override sign(payload: Parameters<JwtService["sign"]>[0], options: Parameters<JwtService["sign"]>[1] = {}) {
    return super.sign(payload, { ...options, keyid: signingKeys().active });
  }
  override async verify(token: string) {
    const header = decodeProtectedHeader(token);
    const key = header.kid ? signingKeys().keys.get(header.kid) : null;
    if (!key || header.alg !== "HS256") throw new McpError("invalid_token", "Access token is invalid.", 401);
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], issuer: mcpOrigin(), audience: mcpResource(), maxTokenAge: "16m", requiredClaims: ["sub", "jti", "exp", "iat", "nbf"] });
    return payload as Record<string, unknown>;
  }
  extraTokenFields() { return { iss: mcpOrigin(), aud: mcpResource() }; }
}

export const authorizationQuerySchema = z.object({
  response_type: z.literal("code"), client_id: z.string().min(1).max(2048),
  redirect_uri: z.string().min(1).max(2048), scope: z.string().min(1).max(300),
  state: z.string().min(1).max(1024), resource: z.string().max(2048),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal("S256"),
  // ChatGPT sends this presentation hint; it never influences authorization.
  ui_locales: z.string().max(200).optional(),
}).strict();

export async function getMcpAuthorizationRequest(query: Record<string, string>) {
  signingKeys();
  const parsed = authorizationQuerySchema.safeParse(query);
  if (!parsed.success) throw new McpError("invalid_request", "Invalid authorization request. PKCE S256, state, and resource are required.");
  const request = parsed.data;
  if (request.resource !== mcpResource()) throw new McpError("invalid_target", "Authorization is for a different resource.");
  validateRedirectUri(request.redirect_uri);
  const client = await resolveMcpClient(request.client_id);
  if (!client.redirectUris.some((uri) => redirectMatches(uri, request.redirect_uri))) throw new McpError("invalid_request", "Callback is not registered for this client.");
  const scopes = parseScopes(request.scope);
  return { clientId: client.id, clientName: client.name, redirectUri: request.redirect_uri, scopes, resource: request.resource, state: request.state, codeChallenge: request.code_challenge };
}

type Binding = { grantId: string; familyId: string; authCodeHash?: string; refreshExpiresAt?: Date };

// Library owns PKCE, grant validation and issuance. Repositories enforce UOVP
// ownership, hashing, revocation and atomic lifetime transitions.
function authorizationServer(db: Prisma.TransactionClient, binding: Binding) {
  const clientRepository: OAuthClientRepository = {
    async getByIdentifier(id) {
      const client = await db.mcpOAuthClient.findUnique({ where: { id } });
      if (!client) throw OAuthException.invalidClient();
      return toClient(client);
    },
    async isClientValid(grant, client, secret) { return !secret && ["authorization_code", "refresh_token"].includes(grant) && client.allowedGrants.includes(grant); },
  };
  const scopeRepository: OAuthScopeRepository = {
    async getAllByIdentifiers(names) { return parseScopes(names).map((name) => ({ name })); },
    async finalize(scopes, _grantType, client, userId) {
      const grant = await db.mcpOAuthGrant.findFirst({ where: { id: binding.grantId, clientId: client.id, ...(userId === undefined ? {} : { userId: String(userId) }), revokedAt: null, user: { mcpEnabled: true }, resource: mcpResource() } });
      if (!grant || scopes.some((scope) => !grant.scopes.includes(scope.name))) throw OAuthException.invalidGrant();
      return scopes;
    },
  };
  const userRepository: OAuthUserRepository = {
    async getUserByCredentials(id, password) {
      if (password) throw OAuthException.invalidGrant();
      const user = await db.user.findFirst({ where: { id: String(id), mcpEnabled: true }, select: { id: true } });
      if (!user) throw OAuthException.invalidGrant();
      return user;
    },
  };
  const authCodeRepository: OAuthAuthCodeRepository = {
    async getByIdentifier(code) {
      const stored = await db.mcpOAuthCode.findUnique({ where: { codeHash: tokenHash(code) }, include: { grant: { include: { client: true } } } });
      if (!stored || stored.grant.revokedAt) throw OAuthException.invalidGrant();
      return { code, client: toClient(stored.grant.client), user: { id: stored.grant.userId }, scopes: stored.grant.scopes.map((name) => ({ name })), redirectUri: stored.redirectUri, codeChallenge: stored.codeChallenge, codeChallengeMethod: "S256", expiresAt: stored.expiresAt };
    },
    issueAuthCode(client, user, scopes): OAuthAuthCode { return { code: secretToken(), client, user, scopes, expiresAt: new Date(Date.now() + 5 * 60_000) }; },
    async persist(code) {
      await db.mcpOAuthCode.create({ data: { codeHash: tokenHash(code.code), grantId: binding.grantId, redirectUri: code.redirectUri!, codeChallenge: code.codeChallenge!, expiresAt: code.expiresAt } });
    },
    async isRevoked(code) {
      const stored = await db.mcpOAuthCode.findUnique({ where: { codeHash: tokenHash(code) } });
      return !stored || Boolean(stored.consumedAt) || stored.expiresAt <= new Date();
    },
    async revoke(code) {
      const changed = await db.mcpOAuthCode.updateMany({ where: { codeHash: tokenHash(code), consumedAt: null }, data: { consumedAt: new Date() } });
      if (changed.count !== 1) throw OAuthException.invalidGrant();
    },
  };
  async function loadToken(where: Prisma.McpOAuthTokenWhereUniqueInput, presentedRefresh?: string): Promise<OAuthToken> {
    const token = await db.mcpOAuthToken.findUnique({ where, include: { grant: { include: { client: true, user: { select: { mcpEnabled: true } } } } } });
    if (!token || token.grantId !== binding.grantId || token.grant.revokedAt || !token.grant.user.mcpEnabled) throw OAuthException.invalidGrant();
    return { accessToken: token.id, accessTokenExpiresAt: token.accessExpiresAt, refreshToken: presentedRefresh, refreshTokenExpiresAt: token.refreshExpiresAt, client: toClient(token.grant.client), user: { id: token.grant.userId }, scopes: token.scopes.map((name) => ({ name })), originatingAuthCodeId: token.authCodeHash ?? undefined };
  }
  const tokenRepository: OAuthTokenRepository = {
    async issueToken(client, scopes, user) { return { accessToken: secretToken(), accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000), client, scopes, user, originatingAuthCodeId: binding.authCodeHash }; },
    async persist(token) {
      await db.mcpOAuthToken.create({ data: { id: token.accessToken, grantId: binding.grantId, familyId: binding.familyId, scopes: token.scopes.map((scope) => scope.name), authCodeHash: binding.authCodeHash, accessExpiresAt: token.accessTokenExpiresAt } });
    },
    async issueRefreshToken(token) {
      const refreshToken = secretToken();
      const expiresAt = binding.refreshExpiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60_000);
      await db.mcpOAuthToken.update({ where: { id: token.accessToken }, data: { refreshHash: tokenHash(refreshToken), refreshExpiresAt: expiresAt } });
      return { ...token, refreshToken, refreshTokenExpiresAt: expiresAt };
    },
    async revoke(token) {
      const changed = await db.mcpOAuthToken.updateMany({ where: { id: token.accessToken, grantId: binding.grantId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (changed.count !== 1) throw OAuthException.invalidGrant();
    },
    async isRefreshTokenRevoked(token) {
      const stored = await db.mcpOAuthToken.findUnique({ where: { id: token.accessToken } });
      return !stored || Boolean(stored.revokedAt) || !stored.refreshExpiresAt || stored.refreshExpiresAt <= new Date();
    },
    async getByRefreshToken(value) { return loadToken({ refreshHash: tokenHash(value) }, value); },
    async revokeDescendantsOf(code) { await db.mcpOAuthToken.updateMany({ where: { authCodeHash: tokenHash(code), revokedAt: null }, data: { revokedAt: new Date() } }); },
  };
  const server = new AuthorizationServer(clientRepository, tokenRepository, scopeRepository, new McpJwtService(), {
    requiresPKCE: true, requiresS256: true, useOpaqueAuthorizationCodes: true, useOpaqueRefreshTokens: true, issuer: mcpOrigin(),
  });
  // Constructor includes client_credentials; repositories and routes reject it.
  server.enableGrantType({ grant: "authorization_code", authCodeRepository, userRepository, authCodeTTL: new DateInterval("5m") }, new DateInterval("15m"));
  server.enableGrantType("refresh_token", new DateInterval("15m"));
  return server;
}

export async function createMcpAuthorization(userId: string, query: Record<string, string>, approvedScopes: McpScope[], approved: boolean) {
  const request = await getMcpAuthorizationRequest(query);
  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("state", request.state); redirect.searchParams.set("iss", mcpOrigin());
  if (!approved) { redirect.searchParams.set("error", "access_denied"); return { redirectUrl: redirect.toString() }; }
  const scopes = parseScopes(approvedScopes);
  if (scopes.some((scope) => !request.scopes.includes(scope))) throw new McpError("invalid_scope", "Consent cannot add permissions.");
  const result = await prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mcp-user:${userId}`}))`;
    const user = await db.user.findFirst({ where: { id: userId, mcpEnabled: true }, select: { id: true } });
    const client = await db.mcpOAuthClient.findUnique({ where: { id: request.clientId } });
    if (!user || !client || (client.ownerId && client.ownerId !== userId)) throw new McpError("access_denied", "Enable MCP access in your settings first.", 403);
    const grant = await db.mcpOAuthGrant.create({ data: { userId, clientId: client.id, scopes, resource: request.resource } });
    const server = authorizationServer(db, { grantId: grant.id, familyId: randomUUID() });
    const authorization = await server.validateAuthorizationRequest(new OAuthRequest({ query: { ...query, scope: scopes.join(" ") } }));
    authorization.user = { id: userId }; authorization.isAuthorizationApproved = true;
    const response = await server.completeAuthorizationRequest(authorization);
    const url = new URL(response.headers.location);
    url.searchParams.set("iss", mcpOrigin());
    return { redirectUrl: url.toString() };
  });
  await opportunisticMcpOAuthCleanup(userId);
  return result;
}

export async function exchangeMcpToken(body: Record<string, string>) {
  signingKeys();
  if (body.resource !== mcpResource()) throw new McpError("invalid_target", "Token request is for a different resource.");
  if (!["authorization_code", "refresh_token"].includes(body.grant_type)) throw new McpError("unsupported_grant_type", "Only authorization code and refresh grants are supported.");
  if (!body.client_id || body.client_secret || body.client_assertion) throw new McpError("invalid_client", "Use a registered public client.");
  const credential = body.grant_type === "authorization_code" ? body.code : body.refresh_token;
  if (!credential || credential.length > 2048) throw new McpError("invalid_grant", "Invalid authorization credential.");
  const hash = tokenHash(credential);
  let cleanupUserId: string | undefined;
  const result = await prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mcp-token:${hash}`}))`;
    const code = body.grant_type === "authorization_code" ? await db.mcpOAuthCode.findUnique({ where: { codeHash: hash }, include: { grant: true } }) : null;
    const token = body.grant_type === "refresh_token" ? await db.mcpOAuthToken.findUnique({ where: { refreshHash: hash }, include: { grant: true } }) : null;
    const grant = code?.grant ?? token?.grant;
    if (!grant || grant.clientId !== body.client_id || grant.resource !== body.resource || grant.revokedAt) throw new McpError("invalid_grant", "Invalid authorization credential.");
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mcp-user:${grant.userId}`}))`;
    const currentGrant = await db.mcpOAuthGrant.findFirst({ where: { id: grant.id, revokedAt: null, user: { mcpEnabled: true } }, select: { id: true } });
    if (!currentGrant) throw new McpError("invalid_grant", "Authorization was revoked.");
    const user = await db.user.findFirst({ where: { id: grant.userId, mcpEnabled: true }, select: { id: true } });
    if (!user) throw new McpError("invalid_grant", "Authorization was revoked.");
    if (code?.consumedAt || token?.revokedAt) {
      // Commit family revocation even though the replay request is refused.
      await db.mcpOAuthToken.updateMany({
        where: { ...(code ? { authCodeHash: hash } : { familyId: token!.familyId }), revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { replay: true as const };
    }
    const binding = { grantId: grant.id, familyId: token?.familyId ?? randomUUID(), authCodeHash: code?.codeHash ?? token?.authCodeHash ?? undefined, refreshExpiresAt: token?.refreshExpiresAt ?? undefined };
    const response = await authorizationServer(db, binding).respondToAccessTokenRequest(new OAuthRequest({ body }));
    cleanupUserId = grant.userId;
    return { replay: false as const, body: response.body, status: response.status };
  }, { timeout: 15_000 });
  if (result.replay) throw new McpError("invalid_grant", "Credential was already used; reconnect this client.");
  if (cleanupUserId) await opportunisticMcpOAuthCleanup(cleanupUserId);
  return result;
}

export async function revokeMcpToken(body: Record<string, string>) {
  if (!body.token || body.token.length > 8192 || !body.client_id) return;
  let id: string | undefined;
  try { const claims = await new McpJwtService().verify(body.token); id = typeof claims.jti === "string" ? claims.jti : undefined; } catch { /* may be an opaque refresh token */ }
  const token = await prisma.mcpOAuthToken.findFirst({ where: { ...(id ? { id } : { refreshHash: tokenHash(body.token) }), grant: { clientId: body.client_id } }, select: { grantId: true, grant: { select: { userId: true } } } });
  if (token) await prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mcp-user:${token.grant.userId}`}))`;
    await db.mcpOAuthGrant.updateMany({ where: { id: token.grantId, clientId: body.client_id }, data: { revokedAt: new Date() } });
  });
}
