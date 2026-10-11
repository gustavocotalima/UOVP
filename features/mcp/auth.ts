import { prisma } from "@/lib/prisma";
import { validTimeZone } from "@/lib/calendar";
import { McpJwtService } from "./oauth";
import { mcpResource, parseScopes, signingKeys } from "./config";
import { McpError, type McpContext } from "./types";

export async function authenticateMcpRequest(request: Request): Promise<McpContext> {
  signingKeys();
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization)) throw new McpError("invalid_token", "Connect your UOVP account using OAuth.", 401);
  try {
    const claims = await new McpJwtService().verify(authorization.slice(7));
    if (typeof claims.jti !== "string" || typeof claims.sub !== "string" || typeof claims.cid !== "string" || typeof claims.scope !== "string") throw new Error("Invalid claims");
    const scopes = parseScopes(claims.scope);
    const token = await prisma.mcpOAuthToken.findFirst({ where: { id: claims.jti, revokedAt: null, accessExpiresAt: { gt: new Date() }, grant: { revokedAt: null, userId: claims.sub, clientId: claims.cid, resource: mcpResource(), user: { mcpEnabled: true } } }, select: { scopes: true, grantId: true, grant: { select: { scopes: true, user: { select: { preference: { select: { timeZone: true } } } } } } } });
    if (!token || scopes.some((scope) => !token.scopes.includes(scope) || !token.grant.scopes.includes(scope))) throw new Error("Revoked");
    return { userId: claims.sub, clientId: claims.cid, grantId: token.grantId, scopes, timeZone: validTimeZone(token.grant.user.preference?.timeZone) };
  } catch { throw new McpError("invalid_token", "Access expired or was revoked. Reconnect your UOVP account.", 401); }
}
