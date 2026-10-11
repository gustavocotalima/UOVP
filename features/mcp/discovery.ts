import { z } from "zod";
import { readAnalysis } from "./query";
import { redactAnalysisText } from "./privacy";
import { mcpOrigin } from "./config";
import { financeTools } from "./finance-tools";
import { portfolioTools } from "./portfolio-tools";
import { McpError, type McpContext } from "./types";

export const discoveryScopes = ["finance:read", "accounts:read", "transactions:read", "portfolio:read", "balance-sheet:read"] as const;
const inputId = z.string().min(1).max(220);
type Document = { id: string; title: string; url: string };
function allowed(context: McpContext, scope: typeof discoveryScopes[number]) {
  if (!context.scopes.includes(scope)) throw new McpError("insufficient_scope", "This document needs an additional permission.", 403);
}

export async function searchMcpDocuments(context: McpContext, input: Record<string, unknown>) {
  const { query } = z.object({ query: z.string().min(1).max(200) }).strict().parse(input);
  const origin = mcpOrigin();
  const results: Document[] = [];
  const period = /\b(20\d{2})-(0[1-9]|1[0-2])\b/.exec(query);
  if (context.scopes.includes("finance:read") && period) results.push({ id: `summary:${period[1]}-${period[2]}`, title: `Financial summary ${period[1]}-${period[2]}`, url: `${origin}/home?year=${period[1]}&month=${Number(period[2])}` });
  if (context.scopes.includes("portfolio:read")) results.push({ id: "portfolio:summary", title: "Current investment portfolio and allocation", url: `${origin}/carteira` });
  await readAnalysis(context, async (db) => {
    if (context.scopes.includes("transactions:read")) {
      const rows = await db.financeTransaction.findMany({ where: { userId: context.userId, deleted: false, account: { userId: context.userId, active: true }, OR: [{ providerLifecycle: null }, { providerLifecycle: { not: "REMOVED" } }], description: { contains: query, mode: "insensitive" } }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 10, select: { id: true, description: true } });
      results.push(...rows.map((row) => ({ id: `transaction:${row.id}`, title: redactAnalysisText(row.description) ?? "Transaction", url: `${origin}/transacoes` })));
    }
    if (context.scopes.includes("portfolio:read")) {
      const rows = await db.assetHolding.findMany({ where: { asset: { portfolio: { userId: context.userId }, OR: [{ ticker: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }] } }, orderBy: { id: "asc" }, take: 10, select: { id: true, productName: true, asset: { select: { ticker: true, name: true } } } });
      results.push(...rows.map((row) => ({ id: `holding:${row.id}`, title: redactAnalysisText(`${row.asset.ticker ?? ""} ${row.productName ?? row.asset.name}`) ?? "Investment", url: `${origin}/carteira` })));
    }
  });
  return { results: results.slice(0, 22) };
}

export async function fetchMcpDocument(context: McpContext, input: Record<string, unknown>) {
  const { id } = z.object({ id: inputId }).strict().parse(input);
  const origin = mcpOrigin();
  let toolName: string; let args: Record<string, unknown>; let title: string; let url: string;
  if (/^summary:20\d{2}-(0[1-9]|1[0-2])$/.test(id)) {
    allowed(context, "finance:read"); const [year, month] = id.slice(8).split("-").map(Number);
    toolName = "get_financial_summary"; args = { year, month }; title = `Financial summary ${year}-${String(month).padStart(2, "0")}`; url = `${origin}/home?year=${year}&month=${month}`;
  } else if (id.startsWith("transaction:") && id.length > 12) {
    allowed(context, "transactions:read"); toolName = "get_transaction"; args = { transactionId: id.slice(12) }; title = "Transaction detail"; url = `${origin}/transacoes`;
  } else if (id.startsWith("holding:") && id.length > 8) {
    allowed(context, "portfolio:read"); toolName = "get_holding_details"; args = { holdingId: id.slice(8) }; title = "Investment position"; url = `${origin}/carteira`;
  } else if (id === "portfolio:summary") {
    allowed(context, "portfolio:read"); toolName = "get_portfolio_summary"; args = {}; title = "Investment portfolio summary"; url = `${origin}/carteira`;
  } else throw new McpError("NOT_FOUND", "Document does not exist.", 404);
  const tool = [...financeTools, ...portfolioTools].find((candidate) => candidate.name === toolName)!;
  const data = await tool.execute(context, args);
  return { id, title, text: JSON.stringify(data), url };
}
