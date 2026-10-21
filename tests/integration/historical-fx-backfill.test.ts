import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { historicalFxBackfillWhere } from "@/scripts/helpers/historical-fx-backfill";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("backfill FX com snapshot concorrente", () => {
  const userIds: string[] = [];

  async function fixture() {
    const user = await db!.user.create({ data: { email: `fx-backfill-${randomUUID()}@example.com` } });
    userIds.push(user.id);
    const account = await db!.financialAccount.create({
      data: { userId: user.id, source: "PLUGGY", name: "Conta externa", type: "BANK_ACCOUNT", currencyCode: "USD" },
    });
    const transaction = await db!.financeTransaction.create({
      data: {
        userId: user.id, accountId: account.id, source: "PLUGGY", kind: "EXPENSE",
        description: "Compra", amount: -100, currencyCode: "USD",
        date: new Date("2026-08-01T12:00:00Z"), referenceYear: 2026, referenceMonth: 8,
      },
    });
    return { user, account, transaction };
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("não aplica uma cotação calculada para valor/data anteriores à revisão do provedor", async () => {
    const f = await fixture();
    // This commit represents a provider sync while the historical HTTP lookup
    // is in flight. The backfill must not attach its stale result to that row.
    await db!.financeTransaction.update({
      where: { id: f.transaction.id },
      data: { amount: -120, date: new Date("2026-08-02T12:00:00Z") },
    });
    const update = await db!.financeTransaction.updateMany({
      where: historicalFxBackfillWhere(f.transaction),
      data: {
        reportingAmountBrl: f.transaction.amount.mul(5), fxRateToBrl: 5,
        fxRateDate: new Date("2026-07-31T00:00:00Z"), fxSource: "YAHOO",
      },
    });
    expect(update.count).toBe(0);
    const current = await db!.financeTransaction.findUniqueOrThrow({ where: { id: f.transaction.id } });
    expect(current.amount.toString()).toBe("-120");
    expect(current.reportingAmountBrl).toBeNull();
    expect(current.fxSource).toBeNull();
  });

  it("aplica uma vez o snapshot intacto e reconhece o replay como nenhuma alteração", async () => {
    const f = await fixture();
    const patch = {
      reportingAmountBrl: new Prisma.Decimal("-528"), fxRateToBrl: new Prisma.Decimal("5.28"),
      fxRateDate: new Date("2026-07-31T00:00:00Z"), fxSource: "YAHOO" as const,
    };
    const first = await db!.financeTransaction.updateMany({ where: historicalFxBackfillWhere(f.transaction), data: patch });
    const replay = await db!.financeTransaction.updateMany({ where: historicalFxBackfillWhere(f.transaction), data: patch });
    expect(first.count).toBe(1);
    expect(replay.count).toBe(0);
    expect((await db!.financeTransaction.findUniqueOrThrow({ where: { id: f.transaction.id } })).reportingAmountBrl?.toString()).toBe("-528");
  });
});
