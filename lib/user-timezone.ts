import "server-only";

import { prisma } from "@/lib/prisma";
import { DEFAULT_TIME_ZONE, validTimeZone } from "@/lib/calendar";

export async function getUserTimeZone(userId: string) {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  return validTimeZone(preference?.timeZone ?? DEFAULT_TIME_ZONE);
}
