"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  createRegistrationInvite,
  normalizeInviteEmail,
} from "./invitations";

async function requireInviteAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) throw new Error("Você não pode administrar convites.");
  return user;
}

export async function listRegistrationInvites() {
  await requireInviteAdmin();
  return prisma.registrationInvite.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}

export async function createRegistrationInviteAction(email: string) {
  const user = await requireInviteAdmin();
  const parsedEmail = z.string().trim().email().max(254).parse(email);
  const normalizedEmail = normalizeInviteEmail(parsedEmail);
  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
  if (existingUser) throw new Error("Já existe uma conta com este e-mail.");
  await prisma.registrationInvite.updateMany({
    where: {
      email: normalizedEmail,
      usedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  const { invite, token } = await createRegistrationInvite(user.id, normalizedEmail);
  revalidatePath("/configuracoes");
  return {
    id: invite.id,
    email: invite.email,
    expiresAt: invite.expiresAt.toISOString(),
    token,
  };
}

export async function revokeRegistrationInviteAction(inviteId: string) {
  await requireInviteAdmin();
  const id = z.string().cuid().parse(inviteId);
  const updated = await prisma.registrationInvite.updateMany({
    where: {
      id,
      usedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  if (updated.count !== 1) throw new Error("Convite não encontrado ou já encerrado.");
  revalidatePath("/configuracoes");
}
