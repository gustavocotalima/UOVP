"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { validTimeZone } from "@/lib/calendar";

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
  await prisma.userPreference.upsert({
    where: { userId },
    update: { timeZone },
    create: { userId, timeZone },
  });
  revalidatePath("/", "layout");
  return { timeZone };
}
