import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { syncAllPluggyItemsForUser, syncPluggyItemForUser } from "@/features/open-finance/sync";
import { getActiveUser } from "@/lib/current-user";
import { isSameOriginRequest } from "@/lib/request-security";
import {
  assertUserOperationRateLimit,
  OperationInProgressError,
  OperationRateLimitError,
} from "@/lib/operation-security";
import { anonymizedUserId, logIntegrationRefresh } from "@/lib/integration-observability";

const inputSchema = z.object({ itemId: z.string().uuid().optional() });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const user = await getActiveUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const input = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!input.success) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });

  try {
    const startedAt = Date.now();
    await assertUserOperationRateLimit({
      userId: user.id,
      operation: "pluggy-sync",
      limit: 8,
      windowMs: 10 * 60_000,
    });
    const result = input.data.itemId
      ? await syncPluggyItemForUser(user.id, input.data.itemId)
      : await syncAllPluggyItemsForUser(user.id);
    ["/open-finance", "/home", "/orcamento-domestico", "/metas", "/contas", "/faturas", "/transacoes", "/tags", "/carteira"].forEach((path) => revalidatePath(path));
    logIntegrationRefresh({
      event: "pluggy-refresh",
      user: anonymizedUserId(user.id),
      reason: "MANUAL",
      scope: input.data.itemId ? "ONE_ITEM" : "ALL_ACTIVE",
      durationMs: Date.now() - startedAt,
      accountCount: result.accountCount,
      transactionCount: result.transactionCount,
      investmentCount: result.investmentCount,
      failedConnections: "failedItemCount" in result ? result.failedItemCount : 0,
    });
    if ("failedItemCount" in result && result.failedItemCount > 0) {
      if (result.succeededItemCount === 0) {
        return NextResponse.json(
          {
            ...result,
            error: "Nenhuma conexão pôde ser sincronizada. Os dados anteriores foram preservados.",
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        {
          ...result,
          warning: `${result.failedItemCount} conexão(ões) não puderam ser sincronizadas.`,
        },
        { status: 207 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof OperationRateLimitError
      ? 429
      : error instanceof OperationInProgressError
        ? 409
        : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível sincronizar." },
      {
        status,
        headers: error instanceof OperationRateLimitError
          ? { "Retry-After": String(error.retryAfterSeconds) }
          : undefined,
      },
    );
  }
}
