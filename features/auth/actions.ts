"use server";

import { hash } from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkRegistrationRateLimit } from "@/lib/auth-security";
import { requireUserId } from "@/lib/current-user";
import { DEFAULT_TARGETS, INVESTMENT_CLASSES } from "@/features/portfolio/constants";
import { DEFAULT_QUESTIONS, defaultQuestionTemplateKey } from "@/features/portfolio/questions";
import { AUVP_FINANCE_GOALS, AUVP_FINANCE_TAGS } from "@/features/finance/data";
import { BUDGET_CATEGORIES } from "@/features/budget/constants";
import { consumeRegistrationInviteInTransaction } from "./invitations";

export type AuthFormState = { error?: string };

const registerSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(100, "O nome é muito longo."),
  email: z.string().trim().email("Informe um e-mail válido.").max(254).transform((value) => value.toLowerCase()),
  password: z.string()
    .min(8, "A senha deve ter pelo menos 8 caracteres.")
    .max(128, "A senha é muito longa.")
    .refine((value) => new TextEncoder().encode(value).length <= 72, "A senha excede o limite seguro de 72 bytes."),
  inviteToken: z.string().max(256).optional().default(""),
});

const loginSchema = registerSchema.pick({ email: true, password: true });

export async function registerAction(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (!await checkRegistrationRateLimit(
    parsed.data.email,
    parsed.data.inviteToken || "first-user-bootstrap",
    await headers(),
  )) {
    return { error: "Não foi possível processar o cadastro agora. Tente novamente mais tarde." };
  }

  const passwordHash = await hash(parsed.data.password, 12);
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw<Array<{ locked: number }>>`
            SELECT 1::int AS "locked"
            FROM pg_advisory_xact_lock(hashtext('uovp:registration-bootstrap'))
          `;
          const isFirstUser = !await tx.user.findFirst({ select: { id: true } });
          if (!isFirstUser && !parsed.data.inviteToken) {
            throw new Error("Cadastro somente por convite.");
          }
          const user = await tx.user.create({
            data: {
              name: parsed.data.name,
              email: parsed.data.email,
              passwordHash,
              isAdmin: isFirstUser,
              preference: { create: {} },
              portfolio: { create: {} },
              financeProfile: { create: {} },
            },
          });
          await Promise.all([
            tx.investmentTarget.createMany({
              data: INVESTMENT_CLASSES.map((investmentClass) => ({
                userId: user.id,
                investmentClass,
                percentage: DEFAULT_TARGETS[investmentClass],
              })),
            }),
            tx.diagramQuestion.createMany({
              data: DEFAULT_QUESTIONS.map((question, sortOrder) => ({
                userId: user.id,
                type: question.type,
                criterion: question.criterion,
                text: question.text,
                sortOrder,
                templateKey: defaultQuestionTemplateKey(question),
              })),
            }),
            tx.financeGoal.createMany({
              data: BUDGET_CATEGORIES.map((category) => ({
                userId: user.id,
                category,
                percentage: AUVP_FINANCE_GOALS[category],
              })),
            }),
            tx.financeTag.createMany({
              data: AUVP_FINANCE_TAGS.map((tag) => ({ userId: user.id, ...tag })),
            }),
          ]);
          if (!isFirstUser) {
            await consumeRegistrationInviteInTransaction(
              tx,
              parsed.data.inviteToken,
              parsed.data.email,
              user.id,
            );
          }
        }, { isolationLevel: "Serializable" });
        break;
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError
          && error.code === "P2034";
        if (!retryable || attempt === 2) throw error;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("convite")) {
      return { error: error.message };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Não foi possível usar este convite." };
    }
    throw error;
  }

  redirect("/login?registration=accepted");
}

export async function loginAction(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/home",
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: "E-mail ou senha inválidos." };
    throw error;
  }
  return {};
}

export async function logoutAction() {
  const userId = await requireUserId();
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
  await signOut({ redirectTo: "/login" });
}
