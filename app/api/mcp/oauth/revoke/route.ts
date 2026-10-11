import { z } from "zod";
import { revokeMcpToken } from "@/features/mcp/oauth";
import { boundedBody, limitMcpHttp, mcpHttpError, privateJson, uniqueParameters } from "@/features/mcp/http";
import { McpError } from "@/features/mcp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ token: z.string().max(8192), client_id: z.string().min(1).max(2048), token_type_hint: z.enum(["access_token", "refresh_token"]).optional() }).strict();
export async function POST(request: Request) {
  try {
    await limitMcpHttp(request);
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new McpError("invalid_request", "Use a form request.");
    const parsed = schema.safeParse(uniqueParameters(new URLSearchParams(await boundedBody(request, 16_384))));
    if (!parsed.success) throw new McpError("invalid_request", "Revocation request is invalid.");
    await revokeMcpToken(parsed.data);
    return privateJson({});
  } catch (error) { return mcpHttpError(error); }
}
