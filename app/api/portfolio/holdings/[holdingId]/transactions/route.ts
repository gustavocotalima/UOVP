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
      investedValueCurrency: true,
      positionSource: true,
      pluggyDiagramLink: {
        select: {
          pluggyInvestmentDbId: true,
          contributionBatches: { where: { state: { in: ["WAITING", "CONFLICT"] } }, select: { id: true }, take: 1 },
          investment: {
            select: {
              amountOriginal: true,
              currencyCode: true,
              purchaseQuantityTotal: true,
              purchaseCostTotal: true,
              purchaseSummaryVersion: true,
            },
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
  const averagePrice = calculateHoldingAveragePrice({
    positionSource: holding.positionSource,
    quantity: holding.quantity.toString(),
    investedValue: holding.investedValue?.toString(),
    investedValueCurrency: holding.investedValueCurrency,
    providerCurrency: pluggyDiagramLink.investment.currencyCode,
    amountOriginal: pluggyDiagramLink.contributionBatches?.length
      ? holding.investedValue?.toString() : pluggyDiagramLink.investment.amountOriginal?.toString(),
    purchaseSummary: {
      version: pluggyDiagramLink.investment.purchaseSummaryVersion,
      quantity: pluggyDiagramLink.investment.purchaseQuantityTotal.toString(),
      cost: pluggyDiagramLink.investment.purchaseCostTotal.toString(),
    },
  });
  const [rows, total] = await Promise.all([
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
  ]);

  return NextResponse.json({
    page: parsedQuery.data.page,
    pageSize: parsedQuery.data.pageSize,
    total,
    averagePricePaid: averagePrice.price?.toString() ?? null,
    averagePriceCurrency: averagePrice.currency,
    averagePriceCoverage: averagePrice.coverage,
    transactions: rows.map((transaction) => ({
      id: transaction.id,
      currencyCode: pluggyDiagramLink.investment.currencyCode,
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
