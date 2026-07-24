import { NextResponse } from "next/server";
import { z } from "zod";
import { createPluggyConnectToken } from "@/features/open-finance/pluggy";
import { requirePluggyCredentials } from "@/features/open-finance/pluggy-credentials";
import { getActiveUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { isSameOriginRequest } from "@/lib/request-security";
import {
  assertUserOperationRateLimit,
  OperationRateLimitError,
} from "@/lib/operation-security";

const inputSchema = z.object({ itemId: z.string().uuid().optional() });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const user = await getActiveUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const input = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!input.success) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });

  if (input.data.itemId) {
    const ownedItem = await prisma.pluggyItem.findFirst({
      where: { userId: user.id, pluggyItemId: input.data.itemId },
      select: { id: true },
    });
    if (!ownedItem) return NextResponse.json({ error: "Conexão não encontrada." }, { status: 404 });
  }

  try {
    await assertUserOperationRateLimit({
      userId: user.id,
      operation: "pluggy-connect-token",
      limit: 20,
      windowMs: 60 * 60_000,
    });
    const credentials = await requirePluggyCredentials(user.id);
    const token = await createPluggyConnectToken(credentials, user.id, input.data.itemId);
    return NextResponse.json(token, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof OperationRateLimitError ? 429 : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível abrir a Pluggy." },
      {
        status,
        headers: error instanceof OperationRateLimitError
          ? { "Retry-After": String(error.retryAfterSeconds) }
          : undefined,
      },
    );
  }
}
