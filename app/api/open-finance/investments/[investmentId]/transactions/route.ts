import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ investmentId: string }> },
) {
  const userId = await requireUserId();
  const { investmentId } = await context.params;
  const parsedId = z.string().cuid().safeParse(investmentId);
  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsedId.success || !parsedQuery.success) {
    return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });
  }
  const investment = await prisma.pluggyInvestment.findFirst({
    where: { id: parsedId.data, item: { userId } },
    select: { id: true },
  });
  if (!investment) return NextResponse.json({ error: "Investimento não encontrado." }, { status: 404 });
  const where = { pluggyInvestmentDbId: investment.id };
  const [rows, total] = await Promise.all([
    prisma.pluggyInvestmentTransaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (parsedQuery.data.page - 1) * parsedQuery.data.pageSize,
      take: parsedQuery.data.pageSize,
    }),
    prisma.pluggyInvestmentTransaction.count({ where }),
  ]);
  return NextResponse.json({
    page: parsedQuery.data.page,
    pageSize: parsedQuery.data.pageSize,
    total,
    transactions: rows.map((transaction) => ({
      id: transaction.id,
      description: transaction.description,
      type: transaction.type,
      movementType: transaction.movementType,
      quantity: transaction.quantity?.toString() ?? null,
      value: transaction.value?.toString() ?? null,
      amount: transaction.amount?.toString() ?? null,
      netAmount: transaction.netAmount?.toString() ?? null,
      agreedRate: transaction.agreedRate?.toString() ?? null,
      brokerageNumber: transaction.brokerageNumber,
      date: transaction.date.toISOString(),
      tradeDate: transaction.tradeDate?.toISOString() ?? null,
      expenses: transaction.expenses,
    })),
  });
}
