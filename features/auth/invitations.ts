import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60_000;

export function normalizeInviteEmail(email: string) {
  return email.trim().toLowerCase();
}

export function registrationInviteHash(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

export function appAdminEmails() {
  return new Set(
    (process.env.APP_ADMIN_EMAILS ?? "")
      .split(",")
      .map(normalizeInviteEmail)
      .filter(Boolean),
  );
}

export function isAppAdminEmail(email: string | null | undefined) {
  return Boolean(email && appAdminEmails().has(normalizeInviteEmail(email)));
}

export async function findUsableRegistrationInvite(token: string) {
  if (token.length < 32 || token.length > 256) return null;
  const invite = await prisma.registrationInvite.findUnique({
    where: { tokenHash: registrationInviteHash(token) },
    select: {
      id: true,
      email: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
    },
  });
  if (
    !invite
    || invite.usedAt
    || invite.revokedAt
    || invite.expiresAt <= new Date()
  ) {
    return null;
  }
  return invite;
}

export async function createRegistrationInvite(createdByUserId: string, email: string) {
  const token = randomBytes(32).toString("base64url");
  const normalizedEmail = normalizeInviteEmail(email);
  const invite = await prisma.registrationInvite.create({
    data: {
      email: normalizedEmail,
      tokenHash: registrationInviteHash(token),
      expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS),
      createdByUserId,
    },
  });
  return { invite, token };
}

export async function consumeRegistrationInviteInTransaction(
  tx: Prisma.TransactionClient,
  token: string,
  email: string,
  usedByUserId: string,
) {
  const tokenHash = registrationInviteHash(token);
  const now = new Date();
  const invite = await tx.registrationInvite.findUnique({ where: { tokenHash } });
  if (
    !invite
    || normalizeInviteEmail(invite.email) !== normalizeInviteEmail(email)
    || invite.usedAt
    || invite.revokedAt
    || invite.expiresAt <= now
  ) {
    throw new Error("Este convite não é válido ou já foi utilizado.");
  }
  const consumed = await tx.registrationInvite.updateMany({
    where: {
      id: invite.id,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      usedAt: now,
      usedByUserId,
    },
  });
  if (consumed.count !== 1) {
    throw new Error("Este convite não é válido ou já foi utilizado.");
  }
}
