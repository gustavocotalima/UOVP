import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// React owns this cache for the current server render. A subsequent request
// resolves auth and sessionVersion again, including role changes/revocations.
export const getActiveUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findFirst({
    where: {
      id: session.user.id,
      sessionVersion: session.user.sessionVersion,
    },
    select: { id: true, name: true, email: true, image: true, isAdmin: true },
  });
});

export async function requireUser() {
  const user = await getActiveUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireUserId() {
  return (await requireUser()).id;
}
