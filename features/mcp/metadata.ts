import { MCP_SCOPES } from "./types";
import { mcpOrigin, mcpResource } from "./config";

export function authorizationMetadata() {
  const origin = mcpOrigin();
  return { issuer: origin, authorization_endpoint: `${origin}/mcp/authorize`, token_endpoint: `${origin}/api/mcp/oauth/token`, revocation_endpoint: `${origin}/api/mcp/oauth/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: [...MCP_SCOPES], client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true };
}
export function resourceMetadata() {
  return { resource: mcpResource(), authorization_servers: [mcpOrigin()], scopes_supported: [...MCP_SCOPES], bearer_methods_supported: ["header"], resource_name: "UOVP read-only financial analysis" };
}
