import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: Request) {
  const userId = await requireUserId();
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Paginação inválida." }, { status: 400 });
  const where = {
    account: {
      item: { userId, status: { not: "DELETED" as const } },
    },
    providerAvailable: true,
  };
  const [rows, total] = await Promise.all([
    prisma.pluggyTransaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (parsed.data.page - 1) * parsed.data.pageSize,
      take: parsed.data.pageSize,
      include: {
        account: {
          select: {
            name: true,
            marketingName: true,
            item: { select: { connectorName: true, institutionName: true } },
          },
        },
      },
    }),
    prisma.pluggyTransaction.count({ where }),
  ]);
  return NextResponse.json({
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    total,
    transactions: rows.map((transaction) => ({
      id: transaction.id,
      institution: transaction.account.item.institutionName
        || transaction.account.item.connectorName,
      accountName: transaction.account.marketingName || transaction.account.name,
      description: transaction.description,
      amount: transaction.amount.toString(),
      currencyCode: transaction.currencyCode,
      date: transaction.date.toISOString(),
      type: transaction.type,
      status: transaction.status,
      category: transaction.category,
      merchantName: transaction.merchantName,
    })),
  });
}
