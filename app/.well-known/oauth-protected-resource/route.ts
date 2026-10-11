import { resourceMetadata } from "@/features/mcp/metadata";
import { privateJson, mcpHttpError } from "@/features/mcp/http";
export const dynamic = "force-dynamic";
export function GET() { try { return privateJson(resourceMetadata()); } catch (error) { return mcpHttpError(error); } }
