import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PluggySyncError, syncAllPluggyItemsForUser, syncPluggyItemForUser } from "@/features/open-finance/sync";
import { getActiveUser } from "@/lib/current-user";
import { isSameOriginRequest } from "@/lib/request-security";
import {
  assertUserOperationRateLimit,
  OperationInProgressError,
  OperationRateLimitError,
} from "@/lib/operation-security";
import { anonymizedUserId, logIntegrationRefresh } from "@/lib/integration-observability";

const inputSchema = z.object({ itemId: z.string().uuid().optional() });
const refreshPaths = ["/open-finance", "/home", "/orcamento-domestico", "/metas", "/contas", "/faturas", "/transacoes", "/tags", "/carteira"];
function revalidateSnapshots() { refreshPaths.forEach((path) => revalidatePath(path)); }

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
    revalidateSnapshots();
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
      if (result.succeededItemCount === 0 && !result.changed) {
        return NextResponse.json(
          {
            ...result,
            error: "Nenhuma conexão pôde ser sincronizada. Não houve atualização dos dados financeiros das conexões.",
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        {
          ...result,
          warning: `${result.failedItemCount} conexão(ões) não puderam ser concluídas.${result.partiallyUpdatedItemCount ? " Parte dos dados já foi atualizada; uma nova sincronização continuará o processo." : ""}`,
        },
        { status: 207 },
      );
    }
    const partialConnections = "partialItemCount" in result
      ? result.partialItemCount
      : result.reservedBalancePartial ? 1 : 0;
    if (partialConnections > 0) {
      return NextResponse.json(
        {
          ...result,
          warning: `${partialConnections} conexão(ões) não informaram todos os saldos reservados. Os valores anteriores foram preservados.`,
        },
        { status: 207 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PluggySyncError) {
      revalidateSnapshots();
      return NextResponse.json({
        changed: true,
        partial: true,
        warning: "A sincronização foi interrompida após atualizar parte dos dados. Uma nova sincronização continuará o processo.",
      }, { status: 207 });
    }
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
