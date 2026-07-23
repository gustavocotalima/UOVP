import { NextResponse } from "next/server";
import { z } from "zod";
import { registerPluggyItemForUser } from "@/features/open-finance/sync";
import { prisma } from "@/lib/prisma";
import { secretsMatch } from "@/lib/request-security";

const webhookSchema = z
  .object({
    event: z.string(),
    eventId: z.string().uuid(),
    itemId: z.string().uuid().optional(),
    clientUserId: z.string().optional().nullable(),
  })
  .passthrough();

export async function POST(request: Request) {
  if (!secretsMatch(request.headers.get("x-pluggy-webhook-secret"), process.env.PLUGGY_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const payload = webhookSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: "Evento inválido." }, { status: 400 });
  if (!payload.data.itemId) return NextResponse.json({ received: true });

  const existing = await prisma.pluggyItem.findUnique({ where: { pluggyItemId: payload.data.itemId } });
  if (payload.data.event === "item/deleted") {
    if (existing) {
      await prisma.pluggyItem.update({
        where: { id: existing.id },
        data: { status: "DELETED", executionStatus: null, syncPending: false },
      });
    }
    return NextResponse.json({ received: true });
  }

  try {
    const userId = existing?.userId ?? payload.data.clientUserId;
    if (!userId) return NextResponse.json({ received: true, linked: false });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return NextResponse.json({ received: true, linked: false });
    const item = await registerPluggyItemForUser(user.id, payload.data.itemId);
    await prisma.pluggyItem.update({ where: { id: item.id }, data: { syncPending: true } });
    return NextResponse.json({ received: true, linked: true });
  } catch {
    return NextResponse.json({ received: true, linked: false });
  }
}
