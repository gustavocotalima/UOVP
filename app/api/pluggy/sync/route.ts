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

const inputSchema = z.object({ itemId: z.string().uuid().optional() });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const user = await getActiveUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const input = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!input.success) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });

  try {
    await assertUserOperationRateLimit({
      userId: user.id,
      operation: "pluggy-sync",
      limit: 8,
      windowMs: 10 * 60_000,
    });
    const result = input.data.itemId
      ? await syncPluggyItemForUser(user.id, input.data.itemId)
      : await syncAllPluggyItemsForUser(user.id);
    ["/open-finance", "/home", "/orcamento-domestico", "/metas", "/contas", "/faturas", "/transacoes", "/tags"].forEach((path) => revalidatePath(path));
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
