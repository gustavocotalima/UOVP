import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function getActiveUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findFirst({
    where: {
      id: session.user.id,
      sessionVersion: session.user.sessionVersion,
    },
    select: { id: true, name: true, email: true, image: true },
  });
}

export async function requireUser() {
  const user = await getActiveUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireUserId() {
  return (await requireUser()).id;
}
