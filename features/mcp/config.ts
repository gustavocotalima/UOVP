import { McpError, MCP_SCOPES, type McpScope } from "./types";

export function mcpOrigin() {
  const url = new URL(process.env.AUTH_URL ?? "http://localhost:3000");
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new McpError("SERVER_CONFIG", "MCP requires a secure canonical AUTH_URL.", 503);
  }
  return url.origin;
}
export function mcpResource() { return `${mcpOrigin()}/api/mcp`; }
export function parseScopes(value: string | string[]): McpScope[] {
  const scopes = [...new Set(Array.isArray(value) ? value : value.trim().split(/\s+/).filter(Boolean))];
  if (!scopes.length || scopes.some((scope) => !MCP_SCOPES.includes(scope as McpScope))) throw new McpError("invalid_scope", "Unknown or empty permissions.");
  return scopes as McpScope[];
}
export function signingKeys() {
  const entries = (process.env.MCP_OAUTH_SIGNING_KEYS ?? "").split(",").filter(Boolean);
  const keys = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const [id, encoded, extra] = entry.trim().split(":");
    if (!id || !/^[A-Za-z0-9_-]{1,32}$/.test(id) || !encoded || extra || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new McpError("SERVER_CONFIG", "MCP signing key configuration is invalid.", 503);
    const key = Buffer.from(encoded, "base64url");
    if (key.length !== 32 || keys.has(id)) throw new McpError("SERVER_CONFIG", "MCP signing key configuration is invalid.", 503);
    keys.set(id, key);
  }
  const active = process.env.MCP_OAUTH_ACTIVE_KEY;
  if (!active || !keys.has(active)) throw new McpError("SERVER_CONFIG", "MCP access is not configured.", 503);
  return { keys, active };
}
export function mcpConfigured() {
  try { signingKeys(); mcpOrigin(); return true; } catch { return false; }
}

export function validateRedirectUri(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new McpError("invalid_request", "Callback URL is invalid."); }
  if (value.length > 2048 || value.includes("*") || url.username || url.password || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))) {
    throw new McpError("invalid_request", "Use an exact HTTPS or native 127.0.0.1 callback URL.");
  }
  return url.toString();
}
export function redirectMatches(registered: string, requested: string) {
  if (registered === requested) return true;
  const left = new URL(registered); const right = new URL(requested);
  if (left.protocol === "http:" && left.hostname === "127.0.0.1" && right.hostname === "127.0.0.1" && right.protocol === "http:") {
    left.port = ""; right.port = "";
    return left.toString() === right.toString();
  }
  return false;
}

export function assertMcpOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  // Remote server clients omit Origin. Browser tools need an explicitly trusted
  // origin; bearer auth remains mandatory regardless of this transport check.
  if (origin !== mcpOrigin() && origin !== "https://chatgpt.com") throw new McpError("FORBIDDEN_ORIGIN", "Origin is not allowed.", 403);
}
