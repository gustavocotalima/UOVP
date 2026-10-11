import { authorizationMetadata } from "@/features/mcp/metadata";
import { privateJson, mcpHttpError } from "@/features/mcp/http";
export const dynamic = "force-dynamic";
export function GET() { try { return privateJson(authorizationMetadata()); } catch (error) { return mcpHttpError(error); } }
