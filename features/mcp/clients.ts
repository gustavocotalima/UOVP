import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { McpError } from "./types";
import { validateRedirectUri } from "./config";

const metadataSchema = z.object({
  client_id: z.string().max(2048),
  client_name: z.string().trim().min(1).max(100),
  redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
  token_endpoint_auth_method: z.string().max(100).optional(),
  token_endpoint_auth_methods_supported: z.array(z.string().max(100)).min(1).max(10).optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
});

export function isTrustedClientMetadataUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "chatgpt.com" && !url.port && !url.username && !url.password && !url.search && !url.hash
      && /^\/oauth\/(?:client\.json|[A-Za-z0-9_-]+\/client\.json|codex\/(?:client\.json|[A-Za-z0-9_-]+\/client\.json))$/.test(url.pathname);
  } catch { return false; }
}

export async function resolveMcpClient(clientId: string) {
  const stored = await prisma.mcpOAuthClient.findUnique({ where: { id: clientId } });
  if (stored && (!stored.metadataUrl || Date.now() - stored.updatedAt.getTime() < 60 * 60_000)) return stored;
  if (!isTrustedClientMetadataUrl(clientId)) {
    if (stored && !stored.metadataUrl) return stored;
    throw new McpError("invalid_client", "Register this client in UOVP settings first.");
  }
  // Narrow public-host/path allowlist and no redirects: no arbitrary metadata URL
  // can reach loopback, private networks, credentials endpoints, or another host.
  const response = await fetch(clientId, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5_000) });
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 16_384) throw new McpError("invalid_client", "Client metadata is unavailable.");
  const reader = response.body?.getReader();
  if (!reader) throw new McpError("invalid_client", "Client metadata is unavailable.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 16_384) { await reader.cancel(); throw new McpError("invalid_client", "Client metadata exceeds limits."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const metadata = metadataSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if (!metadata.success || metadata.data.client_id !== clientId) throw new McpError("invalid_client", "Client metadata is invalid.");
  // Current CIMD documents advertise usable methods as a set. A legacy
  // singular preference (e.g. private_key_jwt) must not hide supported `none`.
  const methods = metadata.data.token_endpoint_auth_methods_supported ?? [metadata.data.token_endpoint_auth_method ?? "none"];
  if (!methods.includes("none")) throw new McpError("invalid_client", "This client must support public-client PKCE authentication.");
  // A public client can advertise callbacks for multiple hosts/platforms. Keep
  // only callbacks our existing policy supports, without broadening that policy
  // or rejecting a valid loopback callback because an unused one is unsupported.
  const redirectUris = [...new Set(metadata.data.redirect_uris.flatMap((uri) => {
    try {
      return [validateRedirectUri(uri)];
    } catch (error) {
      if (error instanceof McpError && error.code === "invalid_request") return [];
      throw error;
    }
  }))];
  if (!redirectUris.length) throw new McpError("invalid_client", "Client metadata has no supported callback URL.");
  return prisma.mcpOAuthClient.upsert({
    where: { id: clientId },
    create: { id: clientId, name: metadata.data.client_name, redirectUris, metadataUrl: clientId },
    update: { name: metadata.data.client_name, redirectUris },
  });
}
