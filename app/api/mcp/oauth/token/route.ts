import { z } from "zod";
import { exchangeMcpToken } from "@/features/mcp/oauth";
import { boundedBody, limitMcpHttp, mcpHttpError, privateJson, uniqueParameters } from "@/features/mcp/http";
import { McpError } from "@/features/mcp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ grant_type: z.enum(["authorization_code", "refresh_token"]), client_id: z.string().min(1).max(2048), resource: z.string().max(2048), code: z.string().max(2048).optional(), redirect_uri: z.string().max(2048).optional(), code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional(), refresh_token: z.string().max(2048).optional(), scope: z.string().max(300).optional() }).strict();
export async function POST(request: Request) {
  try {
    await limitMcpHttp(request);
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded") || request.headers.has("authorization")) throw new McpError("invalid_request", "Use a public-client form request.");
    const parsed = schema.safeParse(uniqueParameters(new URLSearchParams(await boundedBody(request, 16_384))));
    if (!parsed.success) throw new McpError("invalid_request", "Token request is invalid.");
    const result = await exchangeMcpToken(parsed.data as Record<string, string>);
    return privateJson(result.body, result.status);
  } catch (error) { return mcpHttpError(error); }
}
