"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { validTimeZone } from "@/lib/calendar";
import { updateFinancialReferenceSettings } from "@/features/finance/financial-reference";
import { ALLOCATION_METHODS } from "@/features/portfolio/calculation/types";
import { bumpPortfolioAndInvalidateDrafts } from "@/features/portfolio/invalidation";

export async function saveAllocationMethodAction(value: string) {
  const userId = await requireUserId();
  const allocationMethod = z.enum(ALLOCATION_METHODS).parse(value);
  await prisma.$transaction(async (tx) => {
    const previous = await tx.userPreference.findUnique({ where: { userId }, select: { allocationMethod: true } });
    if ((previous?.allocationMethod ?? "IMPROVED") === allocationMethod) return;
    await tx.userPreference.upsert({ where: { userId }, create: { userId, allocationMethod }, update: { allocationMethod } });
    const portfolio = await tx.portfolio.findUnique({ where: { userId }, select: { id: true } });
    if (portfolio) await bumpPortfolioAndInvalidateDrafts(tx, portfolio.id, userId);
  });
  revalidatePath("/configuracoes");
  revalidatePath("/carteira");
  return { allocationMethod };
}

const supportedTimeZones = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Cuiaba",
  "America/Rio_Branco",
  "America/Noronha",
] as const;

export async function saveTimeZoneAction(value: string) {
  const userId = await requireUserId();
  const timeZone = z.enum(supportedTimeZones).parse(value);
  if (validTimeZone(timeZone) !== timeZone) throw new Error("Fuso horário inválido.");
  await prisma.$transaction(async (tx) => {
    await updateFinancialReferenceSettings(tx, userId, { timeZone }, () =>
      tx.userPreference.upsert({
        where: { userId },
        update: { timeZone },
        create: { userId, timeZone },
      }));
  });
  revalidatePath("/", "layout");
  return { timeZone };
}
