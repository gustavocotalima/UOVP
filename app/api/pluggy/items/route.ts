import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { registerPluggyItemForUser, syncPluggyItemForUser } from "@/features/open-finance/sync";
import { getActiveUser } from "@/lib/current-user";
import { isSameOriginRequest } from "@/lib/request-security";

const inputSchema = z.object({ itemId: z.string().uuid() });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const user = await getActiveUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Conexão inválida." }, { status: 400 });

  try {
    await registerPluggyItemForUser(user.id, input.data.itemId);
    const result = await syncPluggyItemForUser(user.id, input.data.itemId);
    ["/open-finance", "/home", "/orcamento-domestico", "/contas", "/faturas", "/transacoes"].forEach((path) => revalidatePath(path));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível registrar a conexão." },
      { status: 502 },
    );
  }
}
