import { authenticateMcpRequest } from "@/features/mcp/auth";
import { assertMcpOrigin } from "@/features/mcp/config";
import { boundedBody, limitMcpHttp, mcpHttpError, privateJson } from "@/features/mcp/http";
import { handleMcpRequest, limitMcpUser } from "@/features/mcp/server";
import { McpError } from "@/features/mcp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await limitMcpHttp(request);
    const context = await authenticateMcpRequest(request);
    await limitMcpUser(context);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new McpError("invalid_request", "Use application/json.", 415);
    let body: unknown;
    try { body = JSON.parse(await boundedBody(request)); } catch (error) { if (error instanceof McpError) throw error; throw new McpError("invalid_request", "JSON body is invalid."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new McpError("invalid_request", "One JSON-RPC message is required.");
    const response = await handleMcpRequest(request, context, body);
    response.headers.set("Cache-Control", "no-store"); response.headers.set("X-Content-Type-Options", "nosniff");
    const origin = request.headers.get("origin");
    if (origin) { response.headers.set("Access-Control-Allow-Origin", origin); response.headers.set("Vary", "Origin"); }
    return response;
  } catch (error) { return mcpHttpError(error); }
}
export function GET() { return privateJson({ error: "method_not_allowed", message: "Use stateless Streamable HTTP POST." }, 405, { Allow: "POST, OPTIONS" }); }
export const DELETE = GET;
export function OPTIONS(request: Request) {
  try {
    assertMcpOrigin(request);
    const headers = new Headers({ "Cache-Control": "no-store", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version", "Access-Control-Expose-Headers": "WWW-Authenticate", Vary: "Origin" });
    const origin = request.headers.get("origin"); if (origin) headers.set("Access-Control-Allow-Origin", origin);
    return new Response(null, { status: 204, headers });
  } catch (error) { return mcpHttpError(error); }
}
