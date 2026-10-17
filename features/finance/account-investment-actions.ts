"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/current-user";
import { withUserOperationLease } from "@/lib/operation-security";
import { accountInvestmentReviewSchema, classifyAccountInvestment, setAccountInvestmentPreference } from "./account-investments";

function revalidate() {
  for (const path of ["/contas", "/carteira", "/home", "/open-finance"]) revalidatePath(path);
}

export async function reviewAccountInvestmentAction(input: z.input<typeof accountInvestmentReviewSchema>) {
  const userId = await requireUserId();
  const parsed = accountInvestmentReviewSchema.parse(input);
  await withUserOperationLease({ userId, operation: "pluggy-sync", leaseMs: 60_000,
    action: (lease) => lease.runFencedTransaction((tx) => classifyAccountInvestment(tx, userId, parsed)),
  });
  revalidate();
}

export async function excludeAccountInvestmentAction(linkId: string) {
  const userId = await requireUserId();
  const id = z.string().cuid().parse(linkId);
  await prisma.$transaction(async (tx) => {
    const link = await tx.accountInvestmentLink.findFirst({ where: { id, account: { userId } } });
    if (!link) throw new Error("Saldo vinculado não encontrado.");
    await tx.$queryRaw`SELECT "id" FROM "FinancialAccount" WHERE "id" = ${link.accountId} FOR UPDATE`;
    await setAccountInvestmentPreference(tx, userId, link.accountId, false);
  });
  revalidate();
}
