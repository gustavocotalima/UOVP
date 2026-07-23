import { prisma } from "@/lib/prisma";
import type { BalanceCategoryKey } from "./constants";

export async function getBalanceSheetData(userId: string) {
  const entries = await prisma.balanceSheetEntry.findMany({ where: { userId }, orderBy: [{ category: "asc" }, { name: "asc" }] });
  return entries.map((entry) => ({ id: entry.id, category: entry.category as BalanceCategoryKey, name: entry.name, value: entry.value.toString() }));
}
