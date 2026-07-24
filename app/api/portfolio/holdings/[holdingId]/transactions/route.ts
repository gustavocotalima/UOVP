import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { calculateHoldingAveragePrice } from "@/features/portfolio/average-price";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ holdingId: string }> },
) {
  const userId = await requireUserId();
  const { holdingId } = await context.params;
  const parsedId = z.string().cuid().safeParse(holdingId);
  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsedId.success || !parsedQuery.success) {
    return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });
  }

  const holding = await prisma.assetHolding.findFirst({
    where: {
      id: parsedId.data,
      asset: { portfolio: { userId } },
    },
    select: {
      quantity: true,
      investedValue: true,
      positionSource: true,
      pluggyDiagramLink: {
        select: {
          pluggyInvestmentDbId: true,
          investment: {
            select: { amountOriginal: true },
          },
        },
      },
    },
  });
  const pluggyDiagramLink = holding?.pluggyDiagramLink;
  const investmentId = pluggyDiagramLink?.pluggyInvestmentDbId;
  if (!holding || !pluggyDiagramLink || !investmentId) {
    return NextResponse.json({ error: "Posição Pluggy não encontrada." }, { status: 404 });
  }

  const where = { pluggyInvestmentDbId: investmentId };
  const [rows, total, averagePriceTransactions] = await Promise.all([
    prisma.pluggyInvestmentTransaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (parsedQuery.data.page - 1) * parsedQuery.data.pageSize,
      take: parsedQuery.data.pageSize,
      select: {
        id: true,
        description: true,
        type: true,
        movementType: true,
        quantity: true,
        value: true,
        amount: true,
        netAmount: true,
        agreedRate: true,
        date: true,
        tradeDate: true,
      },
    }),
    prisma.pluggyInvestmentTransaction.count({ where }),
    prisma.pluggyInvestmentTransaction.findMany({
      where,
      select: {
        type: true,
        quantity: true,
        value: true,
        amount: true,
        netAmount: true,
      },
    }),
  ]);
  const averagePrice = calculateHoldingAveragePrice({
    positionSource: holding.positionSource,
    quantity: holding.quantity.toString(),
    investedValue: holding.investedValue?.toString(),
    amountOriginal: pluggyDiagramLink.investment.amountOriginal?.toString(),
    transactions: averagePriceTransactions,
  });

  return NextResponse.json({
    page: parsedQuery.data.page,
    pageSize: parsedQuery.data.pageSize,
    total,
    averagePricePaid: averagePrice.price?.toString() ?? null,
    averagePriceCoverage: averagePrice.coverage,
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
      date: transaction.date.toISOString(),
      tradeDate: transaction.tradeDate?.toISOString() ?? null,
    })),
  });
}
