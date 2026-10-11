import type { z } from "zod";

export const MCP_SCOPES = ["finance:read", "accounts:read", "transactions:read", "portfolio:read", "balance-sheet:read"] as const;
export type McpScope = typeof MCP_SCOPES[number];
export type McpContext = { userId: string; scopes: McpScope[]; grantId: string; clientId: string; timeZone: string };
export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  inputSchema: z.ZodRawShape;
  outputSchema?: z.ZodRawShape;
  execute: (context: McpContext, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
export type McpSettingsDto = {
  enabled: boolean;
  configured: boolean;
  endpoint: string | null;
  grants: { id: string; clientName: string; scopes: McpScope[]; createdAt: string; lastUsedAt: string | null }[];
  clients: { id: string; name: string; redirectUris: string[] }[];
};

export class McpError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "McpError";
  }
}
