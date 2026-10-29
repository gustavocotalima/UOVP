import { createPrismaClient } from "../../lib/prisma-client";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const observations = vi.hoisted(() => ({
  afterRead: vi.fn<(args: Prisma.FinanceTransactionFindManyArgs) => Promise<void>>(),
  writes: vi.fn(),
  reverseTags: false,
}));
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient: createClient } = await import("@/lib/prisma-client");
  return {
    prisma: createClient().$extends({
      query: {
        financeTransaction: {
          async findMany({ args, query }) {
            const rows = await query(args);
            await observations.afterRead(args);
            if (observations.reverseTags && args.include?.tags) {
              for (const row of rows) {
                if ("tags" in row && Array.isArray(row.tags)) row.tags.reverse();
              }
            }
            return rows;
          },
          async update({ args, query }) {
            observations.writes(args);
            return query(args);
          },
        },
      },
    }),
  };
});

import { prisma } from "@/lib/prisma";
import { classifyFinanceTransactionsForUser } from "@/features/finance/classification-service";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? createPrismaClient() : null;
const suite = enabled ? describe : describe.skip;
const transactionDate = new Date("2026-10-21T12:00:00Z");

suite("classificação financeira paginada e idempotente", () => {
  const userIds: string[] = [];

  beforeEach(() => {
    observations.afterRead.mockReset();
    observations.writes.mockClear();
    observations.reverseTags = false;
  });

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
    await prisma.$disconnect();
  });

  async function fixture() {
    const user = await db!.user.create({ data: { email: `classification-batch-${randomUUID()}@example.com` } });
    userIds.push(user.id);
    const account = await db!.financialAccount.create({
      data: { userId: user.id, source: "MANUAL", type: "BANK_ACCOUNT", name: "Conta de teste", currencyCode: "BRL" },
    });
    const base: Prisma.FinanceTransactionCreateManyInput = {
      userId: user.id, accountId: account.id, source: "PLUGGY", kind: "EXPENSE",
      description: "Compra de mercado", providerCategory: "Groceries", amount: -10,
      date: transactionDate, referenceYear: 2026, referenceMonth: 10,
    };
    return { user, account, base };
  }

  it("lê 251 transações em páginas limitadas e não persegue inserções posteriores ao limite inicial", async () => {
    const f = await fixture();
    const prefix = `batch-${randomUUID()}-`;
    const ids = Array.from({ length: 251 }, (_, index) => `${prefix}${String(index).padStart(3, "0")}`);
    await db!.financeTransaction.createMany({ data: ids.map((id) => ({ ...f.base, id })) });
    const lateId = `${prefix}999`;
    let inserted = false;
    observations.afterRead.mockImplementation(async (args) => {
      if (args.select?.id && !inserted) {
        inserted = true;
        await db!.financeTransaction.create({ data: { ...f.base, id: lateId } });
      }
    });

    const summary = await classifyFinanceTransactionsForUser(f.user.id);

    expect(summary).toEqual({ processed: 251, metasAssigned: 251, tagsAssigned: 251, internalTransfersDetected: 0, unclassified: 0 });
    const selectionReads = observations.afterRead.mock.calls.map(([args]) => args).filter((args) => args.select?.id);
    expect(selectionReads).toHaveLength(3);
    expect(selectionReads.every((args) => args.take === 100 && args.orderBy && "id" in args.orderBy)).toBe(true);
    expect(selectionReads[0].where).toMatchObject({ AND: [{ userId: f.user.id, source: "PLUGGY", deleted: false }, { id: { lte: ids.at(-1) } }] });
    expect(selectionReads[1].where).toMatchObject({ AND: [expect.anything(), { id: { gt: ids[99], lte: ids.at(-1) } }] });
    expect(observations.afterRead.mock.calls.every(([args]) => args.take === 100)).toBe(true);
    expect(observations.writes).toHaveBeenCalledTimes(251);
    expect(await db!.financeTransaction.findUniqueOrThrow({ where: { id: lateId } })).toMatchObject({ budgetCategorySource: "UNASSIGNED", classifiedAt: null });
  });

  it("reexecução não grava nem altera timestamps, mesmo com tags em ordem diferente", async () => {
    const f = await fixture();
    const manualTag = await db!.financeTag.create({ data: { userId: f.user.id, name: "Escolha manual", color: "#123456" } });
    const automatic = await db!.financeTransaction.create({
      data: { ...f.base, providerCategory: "Groceries Utilities", tags: { create: { tagId: manualTag.id, source: "MANUAL" } } },
    });
    const unknown = await db!.financeTransaction.create({ data: { ...f.base, providerCategory: null } });
    const manual = await db!.financeTransaction.create({
      data: {
        ...f.base, budgetCategory: "GOALS", budgetCategorySource: "MANUAL", tagAssignmentSource: "MANUAL",
        internalTransferSource: "MANUAL", tags: { create: { tagId: manualTag.id, source: "MANUAL" } },
      },
    });
    const first = await classifyFinanceTransactionsForUser(f.user.id);
    expect(observations.writes).toHaveBeenCalledTimes(1);
    const before = await db!.financeTransaction.findMany({ where: { userId: f.user.id }, include: { tags: true }, orderBy: { id: "asc" } });
    observations.writes.mockClear();
    observations.reverseTags = true;

    const second = await classifyFinanceTransactionsForUser(f.user.id);

    expect(second).toEqual(first);
    expect(second).toEqual({ processed: 3, metasAssigned: 1, tagsAssigned: 2, internalTransfersDetected: 0, unclassified: 1 });
    expect(observations.writes).not.toHaveBeenCalled();
    expect(await db!.financeTransaction.findMany({ where: { userId: f.user.id }, include: { tags: true }, orderBy: { id: "asc" } })).toEqual(before);
    const auto = before.find((row) => row.id === automatic.id)!;
    expect(auto.tags).toEqual(expect.arrayContaining([{ transactionId: automatic.id, tagId: manualTag.id, source: "MANUAL" }]));
    expect(auto.tags).toHaveLength(3);
    expect(before.find((row) => row.id === unknown.id)?.classifiedAt).toBeNull();
    expect(before.find((row) => row.id === manual.id)?.classifiedAt).toBeNull();
  });

  it("persiste mudança de origem das mesmas tags e limpa a regra removida sem perder tags manuais", async () => {
    const f = await fixture();
    const row = await db!.financeTransaction.create({ data: f.base });
    await classifyFinanceTransactionsForUser(f.user.id, [row.id]);
    const food = await db!.financeTag.findUniqueOrThrow({ where: { userId_systemKey: { userId: f.user.id, systemKey: "FOOD" } } });
    const manualTag = await db!.financeTag.create({ data: { userId: f.user.id, name: "Persistente", color: "#654321" } });
    await db!.financeTransactionTag.create({ data: { transactionId: row.id, tagId: manualTag.id, source: "MANUAL" } });
    const rule = await db!.financeClassificationRule.create({
      data: {
        userId: f.user.id, kind: "EXPENSE", matchType: "DESCRIPTION", matchValue: "COMPRA DE MERCADO", matchLabel: "Mercado",
        assignsTags: true, tags: { create: { tagId: food.id } },
      },
    });
    observations.writes.mockClear();
    await classifyFinanceTransactionsForUser(f.user.id, [row.id]);
    expect(observations.writes).toHaveBeenCalledTimes(1);
    expect(await db!.financeTransaction.findUniqueOrThrow({ where: { id: row.id }, include: { tags: true } })).toMatchObject({
      classificationRuleId: rule.id, tagAssignmentSource: "USER_RULE",
      tags: expect.arrayContaining([{ transactionId: row.id, tagId: food.id, source: "USER_RULE" }, { transactionId: row.id, tagId: manualTag.id, source: "MANUAL" }]),
    });

    await db!.financeClassificationRule.delete({ where: { id: rule.id } });
    observations.writes.mockClear();
    await classifyFinanceTransactionsForUser(f.user.id, [row.id]);
    expect(observations.writes).toHaveBeenCalledTimes(1);
    expect(await db!.financeTransaction.findUniqueOrThrow({ where: { id: row.id }, include: { tags: true } })).toMatchObject({
      classificationRuleId: null, tagAssignmentSource: "PROVIDER_DEFAULT",
      tags: expect.arrayContaining([{ transactionId: row.id, tagId: food.id, source: "PROVIDER_DEFAULT" }, { transactionId: row.id, tagId: manualTag.id, source: "MANUAL" }]),
    });
  });

  it("preserva a origem MANUAL quando a regra deseja a mesma tag", async () => {
    const f = await fixture();
    const row = await db!.financeTransaction.create({ data: f.base });
    await classifyFinanceTransactionsForUser(f.user.id, [row.id]);
    const food = await db!.financeTag.findUniqueOrThrow({ where: { userId_systemKey: { userId: f.user.id, systemKey: "FOOD" } } });
    await db!.financeTransactionTag.update({ where: { transactionId_tagId: { transactionId: row.id, tagId: food.id } }, data: { source: "MANUAL" } });
    await db!.financeClassificationRule.create({
      data: { userId: f.user.id, kind: "EXPENSE", matchType: "DESCRIPTION", matchValue: "COMPRA DE MERCADO", matchLabel: "Mercado", assignsTags: true, tags: { create: { tagId: food.id } } },
    });

    await classifyFinanceTransactionsForUser(f.user.id, [row.id]);

    expect(await db!.financeTransactionTag.findMany({ where: { transactionId: row.id } })).toEqual([{ transactionId: row.id, tagId: food.id, source: "MANUAL" }]);
    observations.writes.mockClear();
    await classifyFinanceTransactionsForUser(f.user.id, [row.id]);
    expect(observations.writes).not.toHaveBeenCalled();
  });

  it("deduplica IDs e mantém filtros de titular, origem e exclusão", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const row = await db!.financeTransaction.create({ data: f.base });
    const ownManual = await db!.financeTransaction.create({ data: { ...f.base, source: "MANUAL" } });
    const deleted = await db!.financeTransaction.create({ data: { ...f.base, deleted: true } });
    const other = await db!.financeTransaction.create({ data: foreign.base });

    expect(await classifyFinanceTransactionsForUser(f.user.id, [row.id, row.id, ownManual.id, deleted.id, other.id, row.id])).toMatchObject({ processed: 1 });
    const selection = observations.afterRead.mock.calls.find(([args]) => args.select?.id)![0];
    expect(selection.where).toMatchObject({ AND: [{ id: { in: [row.id, ownManual.id, deleted.id, other.id] } }, expect.anything()] });
    expect(observations.writes).toHaveBeenCalledTimes(1);
    for (const id of [ownManual.id, deleted.id, other.id]) {
      expect(await db!.financeTransaction.findUniqueOrThrow({ where: { id } })).toMatchObject({ budgetCategorySource: "UNASSIGNED", classifiedAt: null });
    }
  });

  it("classificações concorrentes tomam a decisão após o lock e gravam a mudança uma única vez", async () => {
    const f = await fixture();
    const row = await db!.financeTransaction.create({ data: f.base });
    // Initialize tags outside the race, leaving the financial row unmodified.
    await classifyFinanceTransactionsForUser(f.user.id, []);
    observations.writes.mockClear();

    const results = await Promise.all([
      classifyFinanceTransactionsForUser(f.user.id, [row.id]),
      classifyFinanceTransactionsForUser(f.user.id, [row.id]),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ processed: 1, metasAssigned: 1, tagsAssigned: 1 });
    expect(observations.writes).toHaveBeenCalledTimes(1);
  });
});
