import { createPrismaClient } from "../../lib/prisma-client";
import { randomUUID } from "node:crypto";
import { type PluggyInvestmentSource } from "@/generated/prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const observations = vi.hoisted(() => ({ links: vi.fn(), conflicts: vi.fn(), accountReads: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient: createClient } = await import("@/lib/prisma-client");
  return {
    prisma: createClient().$extends({
      query: {
        accountInvestmentLink: { async findMany({ args, query }) { observations.links(args); return query(args); } },
        pluggyInvestmentDiagramLink: { async findMany({ args, query }) { observations.conflicts(args); return query(args); } },
        financialAccount: { async findUniqueOrThrow({ args, query }) { observations.accountReads(args); return query(args); } },
      },
    }),
  };
});

import { prisma } from "@/lib/prisma";
import { accountInvestmentReviews } from "@/features/finance/account-investment-dto";
import { accountAutomaticBalanceConflicts } from "@/features/finance/account-investments";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? createPrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("revisões de saldo com conflitos consultados em lote", () => {
  const userIds: string[] = [];

  beforeEach(() => {
    observations.links.mockClear();
    observations.conflicts.mockClear();
    observations.accountReads.mockClear();
  });

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
    await prisma.$disconnect();
  });

  async function fixture() {
    const suffix = randomUUID();
    const user = await db!.user.create({ data: { email: `review-batch-${suffix}@example.com`, portfolio: { create: {} } }, include: { portfolio: true } });
    userIds.push(user.id);
    const item = await db!.pluggyItem.create({ data: { userId: user.id, pluggyItemId: `review-item-${suffix}`, connectorName: "Banco de teste", status: "UPDATED" } });
    const asset = await db!.asset.create({ data: { portfolioId: user.portfolio!.id, investmentClass: "FIXED_INCOME", instrumentType: "FIXED_INCOME", ticker: "REVIEW", name: "Saldos automáticos" } });
    return { user, item, asset };
  }

  async function account(f: Awaited<ReturnType<typeof fixture>>, index: number, external = true) {
    const externalId = `review-account-${f.user.id}-${index}`;
    const raw = external ? await db!.pluggyAccount.create({ data: { pluggyItemDbId: f.item.id, pluggyAccountId: externalId, type: "BANK", name: "Conta com nome igual" } }) : null;
    const row = await db!.financialAccount.create({
      data: { userId: f.user.id, source: external ? "PLUGGY" : "MANUAL", externalId: raw?.pluggyAccountId, type: "BANK_ACCOUNT", name: "Conta com nome igual", institutionName: "Banco", balance: 100, currencyCode: "BRL" },
    });
    const link = await db!.accountInvestmentLink.create({ data: { accountId: row.id, enabled: true, status: "NEEDS_REVIEW" } });
    return { row, raw, link };
  }

  async function conflict(
    f: Awaited<ReturnType<typeof fixture>>,
    a: Awaited<ReturnType<typeof account>>,
    name: string,
    options: { source?: PluggyInvestmentSource; included?: boolean; available?: boolean; mapped?: boolean } = {},
  ) {
    const investment = await db!.pluggyInvestment.create({
      data: {
        pluggyItemDbId: f.item.id, pluggyAccountDbId: a.raw!.id, pluggyInvestmentId: `review-position-${randomUUID()}`,
        source: options.source ?? "ACCOUNT_AUTOMATIC_BALANCE", name, type: "FIXED_INCOME", balance: 100, providerAvailable: options.available ?? true,
      },
    });
    const holding = await db!.assetHolding.create({
      data: { assetId: f.asset.id, issuer: "Banco", productName: name, positionSource: "PLUGGY", pricingSource: "PLUGGY", currentValue: 100, includedInTotals: options.included ?? true },
    });
    await db!.pluggyInvestmentDiagramLink.create({
      data: { userId: f.user.id, pluggyInvestmentDbId: investment.id, assetHoldingId: holding.id, status: options.mapped === false ? "NEEDS_REVIEW" : "MAPPED" },
    });
    return investment;
  }

  it("usa duas consultas de domínio para 32 contas, mantendo os conflitos pela identidade da conta", async () => {
    const f = await fixture();
    const accounts: Awaited<ReturnType<typeof account>>[] = [];
    for (let index = 0; index < 32; index += 1) {
      const a = await account(f, index);
      accounts.push(a);
      await conflict(f, a, `Saldo automático ${index}`);
    }
    await conflict(f, accounts[0], "Outro saldo automático da primeira conta");

    const reviews = await accountInvestmentReviews(prisma, f.user.id);

    expect(reviews).toHaveLength(32);
    expect(observations.links).toHaveBeenCalledTimes(1);
    expect(observations.conflicts).toHaveBeenCalledTimes(1);
    expect(observations.accountReads).not.toHaveBeenCalled();
    for (let index = 0; index < accounts.length; index += 1) {
      const review = reviews.find((row) => row.accountBalanceSource?.accountId === accounts[index].row.id)!;
      const expected = (await accountAutomaticBalanceConflicts(db!, accounts[index].row.id)).map((row) => row.investment.name);
      expect([...review.accountBalanceSource!.automaticBalanceConflicts].sort()).toEqual(expected.sort());
      expect(review).toMatchObject({ source: "ACCOUNT_BALANCE", balance: "100", currencyCode: "BRL" });
    }
    expect(reviews.find((row) => row.accountBalanceSource?.accountId === accounts[0].row.id)?.accountBalanceSource?.automaticBalanceConflicts).toHaveLength(2);
  });

  it("exclui fontes reservadas, posições não incluídas, indisponíveis e não mapeadas", async () => {
    const f = await fixture();
    const a = await account(f, 0);
    await conflict(f, a, "Automático válido");
    await conflict(f, a, "Caixinha", { source: "ACCOUNT_RESERVED_BALANCE" });
    await conflict(f, a, "Investimento independente", { source: "INVESTMENTS_API" });
    await conflict(f, a, "Excluído do patrimônio", { included: false });
    await conflict(f, a, "Removido pelo provedor", { available: false });
    await conflict(f, a, "Pendente de revisão", { mapped: false });

    const reviews = await accountInvestmentReviews(prisma, f.user.id);

    expect(reviews).toHaveLength(1);
    expect(reviews[0].accountBalanceSource?.automaticBalanceConflicts).toEqual(["Automático válido"]);
    expect(observations.links).toHaveBeenCalledTimes(1);
    expect(observations.conflicts).toHaveBeenCalledTimes(1);
  });

  it("mantém isolamento por usuário e só inclui vínculos habilitados de contas bancárias ativas e positivas", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const own = await account(f, 0);
    await conflict(f, own, "Saldo do titular");
    const other = await account(foreign, 0);
    await conflict(foreign, other, "Saldo de outro titular");
    for (const [index, data] of [
      [1, { active: false }],
      [2, { balance: 0 }],
      [3, { balance: -20 }],
      [4, { type: "CREDIT_CARD" as const }],
    ] as const) {
      const excluded = await account(f, index);
      await db!.financialAccount.update({ where: { id: excluded.row.id }, data });
      await conflict(f, excluded, `Conta excluída ${index}`);
    }
    const disabled = await account(f, 5);
    await db!.accountInvestmentLink.update({ where: { id: disabled.link.id }, data: { enabled: false } });
    const mapped = await account(f, 6);
    await db!.accountInvestmentLink.update({ where: { id: mapped.link.id }, data: { status: "MAPPED" } });

    const reviews = await accountInvestmentReviews(prisma, f.user.id);

    expect(reviews).toHaveLength(1);
    expect(reviews[0].accountBalanceSource).toMatchObject({ accountId: own.row.id, automaticBalanceConflicts: ["Saldo do titular"] });
    expect(observations.conflicts.mock.calls[0][0]).toMatchObject({ where: { userId: f.user.id, investment: { item: { userId: f.user.id }, sourceAccount: { pluggyAccountId: { in: [own.raw!.pluggyAccountId] } } } } });
  });

  it("contas manuais sem identidade externa não disparam busca de conflitos", async () => {
    const f = await fixture();
    const a = await account(f, 0, false);

    const reviews = await accountInvestmentReviews(prisma, f.user.id);

    expect(reviews).toHaveLength(1);
    expect(reviews[0].accountBalanceSource).toMatchObject({ accountId: a.row.id, automaticBalanceConflicts: [] });
    expect(observations.links).toHaveBeenCalledTimes(1);
    expect(observations.conflicts).not.toHaveBeenCalled();
    expect(observations.accountReads).not.toHaveBeenCalled();
  });
});
