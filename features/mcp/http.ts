import { OAuthException } from "@jmondi/oauth2-server";
import { consumeAuthRateLimit, clientIpFromHeaders } from "@/lib/auth-security";
import { mcpOrigin, assertMcpOrigin } from "./config";
import { McpError } from "./types";

export function privateJson(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store"); headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { status, headers });
}
export function mcpHttpError(error: unknown) {
  if (error instanceof McpError) return privateJson({ error: error.code, error_description: error.message }, error.status, error.status === 401 ? { "WWW-Authenticate": `Bearer resource_metadata="${mcpOrigin()}/.well-known/oauth-protected-resource/api/mcp"` } : undefined);
  if (error instanceof OAuthException) return privateJson({ error: error.errorType, error_description: "OAuth request could not be completed. Verify permissions, callback and PKCE, or reconnect." }, error.status);
  return privateJson({ error: "server_error", error_description: "UOVP could not complete this request." }, 500);
}
export async function limitMcpHttp(request: Request) {
  assertMcpOrigin(request);
  const limits = [consumeAuthRateLimit({ scope: "mcp-global", identifier: "application", limit: 1000, windowMs: 60 * 60_000, blockMs: 60_000 })];
  const ip = clientIpFromHeaders(request.headers);
  if (ip) limits.push(consumeAuthRateLimit({ scope: "mcp-ip", identifier: ip, limit: 120, windowMs: 60_000, blockMs: 60_000 }));
  if ((await Promise.all(limits)).some((limit) => !limit.allowed)) throw new McpError("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
}
export async function boundedBody(request: Request, maxBytes = 65_536) {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new McpError("TOO_LARGE", "Request exceeds limits.", 413);
  const reader = request.body?.getReader(); if (!reader) return "";
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > maxBytes) { await reader.cancel(); throw new McpError("TOO_LARGE", "Request exceeds limits.", 413); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
export function uniqueParameters(params: URLSearchParams) {
  const values: Record<string, string> = Object.create(null);
  for (const [key, value] of params) { if (Object.hasOwn(values, key)) throw new McpError("invalid_request", "Duplicate parameters are not supported."); values[key] = value; }
  return values;
}
