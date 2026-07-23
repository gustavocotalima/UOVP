"use server";

import { revalidatePath } from "next/cache";
import type { BalanceSheetCategory } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/current-user";
import { BALANCE_CATEGORIES } from "./constants";

export async function saveBalanceEntryAction(input: { id?: string; category: (typeof BALANCE_CATEGORIES)[number]; name: string; value: number }) {
  const userId = await requireUserId();
  const parsed = z.object({ id: z.string().cuid().optional(), category: z.enum(BALANCE_CATEGORIES), name: z.string().trim().min(2).max(120), value: z.number().min(0).max(1_000_000_000_000) }).parse(input);
  if (parsed.id) {
    const updated = await prisma.balanceSheetEntry.updateMany({ where: { id: parsed.id, userId }, data: { category: parsed.category as BalanceSheetCategory, name: parsed.name, value: parsed.value } });
    if (!updated.count) throw new Error("Lançamento não encontrado.");
  } else {
    await prisma.balanceSheetEntry.create({ data: { userId, category: parsed.category as BalanceSheetCategory, name: parsed.name, value: parsed.value } });
  }
  revalidatePath("/ferramentas");
}

export async function deleteBalanceEntryAction(id: string) {
  const userId = await requireUserId();
  const deleted = await prisma.balanceSheetEntry.deleteMany({ where: { id, userId } });
  if (!deleted.count) throw new Error("Lançamento não encontrado.");
  revalidatePath("/ferramentas");
}
