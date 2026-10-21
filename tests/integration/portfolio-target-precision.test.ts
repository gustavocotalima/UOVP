import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";

const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => currentUser.id }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveInvestmentTargetsAction } from "@/features/portfolio/actions";
import { DEFAULT_TARGETS, INVESTMENT_CLASSES, type InvestmentClassKey } from "@/features/portfolio/constants";
import { investmentTargetsTotalCents, parseTargetDrafts, toTargetDrafts } from "@/features/portfolio/target-drafts";

const db = process.env.DATABASE_URL ? new PrismaClient() : null;
const suite = db ? describe : describe.skip;

suite("precisão persistida das metas de investimento", () => {
  const userIds: string[] = [];

  async function fixture() {
    const user = await db!.user.create({
      data: { email: `target-precision-${randomUUID()}@example.com`, portfolio: { create: {} } },
      include: { portfolio: true },
    });
    currentUser.id = user.id;
    userIds.push(user.id);
    await db!.investmentTarget.createMany({ data: INVESTMENT_CLASSES.map((investmentClass) => ({
      userId: user.id, investmentClass, percentage: DEFAULT_TARGETS[investmentClass],
    })) });
    return user;
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("rejeita soma 100 com subcentésimos sem arredondar dados ou alterar a versão da carteira", async () => {
    const user = await fixture();
    const before = await db!.investmentTarget.findMany({ where: { userId: user.id }, orderBy: { investmentClass: "asc" } });
    await expect(saveInvestmentTargetsAction({
      ...DEFAULT_TARGETS, INTERNATIONAL_STOCKS: 10.004, BRAZILIAN_STOCKS: 20.004, FIXED_INCOME: 44.992,
    })).rejects.toThrow(/duas casas decimais/);
    expect(await db!.investmentTarget.findMany({ where: { userId: user.id }, orderBy: { investmentClass: "asc" } })).toEqual(before);
    expect(await db!.portfolio.findUniqueOrThrow({ where: { userId: user.id } })).toEqual(user.portfolio);
  });

  it("persiste 0.29 + 99.71 exatamente e preserva 100% após roundtrip pelos drafts", async () => {
    const user = await fixture();
    const values = Object.fromEntries(INVESTMENT_CLASSES.map((key) => [key, 0])) as Record<InvestmentClassKey, number>;
    values.INTERNATIONAL_STOCKS = 0.29;
    values.BRAZILIAN_STOCKS = 99.71;
    await saveInvestmentTargetsAction(values);
    const rows = await db!.investmentTarget.findMany({ where: { userId: user.id }, orderBy: { investmentClass: "asc" } });
    const reloaded = Object.fromEntries(rows.map((target) => [target.investmentClass, target.percentage.toNumber()])) as Record<InvestmentClassKey, number>;
    expect(reloaded).toEqual(values);
    expect(rows.find((target) => target.investmentClass === "INTERNATIONAL_STOCKS")?.percentage.toString()).toBe("0.29");
    expect(rows.find((target) => target.investmentClass === "BRAZILIAN_STOCKS")?.percentage.toString()).toBe("99.71");
    const parsed = parseTargetDrafts(toTargetDrafts(reloaded));
    expect(parsed).not.toBeNull();
    expect(investmentTargetsTotalCents(parsed!)).toBe(10_000);
    await saveInvestmentTargetsAction(parsed!);
    expect((await db!.investmentTarget.findMany({ where: { userId: user.id }, orderBy: { investmentClass: "asc" } }))
      .map((target) => ({ id: target.id, value: target.percentage.toString() })))
      .toEqual(rows.map((target) => ({ id: target.id, value: target.percentage.toString() })));
    await expect(saveInvestmentTargetsAction({ ...values, BRAZILIAN_STOCKS: 99.70 })).rejects.toThrow("As metas precisam totalizar 100%.");
  });
});
