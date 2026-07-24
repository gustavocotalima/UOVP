import { NextResponse } from "next/server";
import { z } from "zod";
import { BUDGET_CATEGORIES } from "@/features/budget/constants";
import {
  getFinanceTransactionsPage,
  type FinanceTransactionPageInput,
} from "@/features/finance/data";
import { requireUserId } from "@/lib/current-user";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1).max(12),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  mode: z.enum(["MONTH", "UNCLASSIFIED", "DELETIONS"]).default("MONTH"),
  search: z.string().trim().max(200).optional(),
  min: z.coerce.number().finite().nonnegative().optional(),
  max: z.coerce.number().finite().nonnegative().optional(),
  kind: z.enum(["INCOME", "EXPENSE"]).optional(),
  category: z.enum(["NONE", ...BUDGET_CATEGORIES]).optional(),
  tagId: z.string().max(100).optional(),
  assignmentSource: z.enum(["UNASSIGNED", "PROVIDER_DEFAULT", "USER_RULE", "MANUAL"]).optional(),
  accountId: z.string().cuid().optional(),
  ignored: z.enum(["yes", "no"]).optional(),
  internal: z.enum(["yes", "no"]).optional(),
  sortKey: z.enum(["description", "amount", "date", "account"]).default("date"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
}).refine((value) => value.min === undefined || value.max === undefined || value.min <= value.max, {
  message: "A faixa de valores é inválida.",
});

export async function GET(request: Request) {
  const userId = await requireUserId();
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Filtros ou paginação inválidos." }, { status: 400 });
  }
  const input: FinanceTransactionPageInput = {
    ...parsed.data,
    tagId: parsed.data.tagId as FinanceTransactionPageInput["tagId"],
  };
  return NextResponse.json(await getFinanceTransactionsPage(userId, input));
}
