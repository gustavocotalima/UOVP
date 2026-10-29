import { createPrismaClient } from "../../lib/prisma-client";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

const caller = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => caller.id }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveAllocationMethodAction } from "@/features/settings/actions";
import { calculateContributionAction, recordContributionAction } from "@/features/portfolio/actions";
vi.mock("@/features/portfolio/yahoo-finance", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/portfolio/yahoo-finance")>(),
  fetchYahooFxRates: vi.fn(async () => [{ currency: "USD", rateToBrl: 1, asOf: new Date() }]),
}));
import { portfolioTools } from "@/features/mcp/portfolio-tools";
import { ALLOCATION_VERSIONS } from "@/features/portfolio/calculation/types";

const db = process.env.DATABASE_URL ? createPrismaClient() : null;
const suite = db ? describe : describe.skip;
suite("per-user allocation methods", () => {
  const users: string[] = [];
  async function fixture() {
    const user = await db!.user.create({ data: { email: `allocation-${randomUUID()}@example.com`,
      portfolio: { create: {} }, preference: { create: {} } }, include: { portfolio: true, preference: true } });
    users.push(user.id); caller.id = user.id;
    await db!.investmentTarget.create({ data: { userId: user.id, investmentClass: "BRAZILIAN_STOCKS", percentage: 100 } });
    await db!.asset.create({ data: { portfolioId: user.portfolio!.id, ticker: "SYNTH3", name: "Synthetic", score: 10,
      investmentClass: "BRAZILIAN_STOCKS", instrumentType: "STOCK", holdings: { create: {
        issuer: "Synthetic", productName: "Synthetic", quantity: 10, unitPrice: 25, currency: "BRL", pricingSource: "MANUAL", positionSource: "MANUAL",
      } } } });
    return user;
  }
  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
  });
  it("returns the Improved method/version without saving calculations or changing holdings", async () => {
    const user = await fixture();
    expect(user.preference!.allocationMethod).toBe("IMPROVED");
    const before = await db!.assetHolding.findMany({ where: { asset: { portfolioId: user.portfolio!.id } } });
    const result = await calculateContributionAction(100, "BRL", "BRL_ONLY");
    expect(result.allocationMethod).toBe("IMPROVED");
    expect(result.calculation.algorithm).toBe("IMPROVED");
    expect(result.calculation.version).toBe(ALLOCATION_VERSIONS.IMPROVED);
    expect(result.suggestions.reduce((sum, item) => sum + Number(item.value), Number(result.unallocatedAmount))).toBeCloseTo(Number(result.requestedAmount));
    expect(await db!.pendingContribution.count({ where: { userId: user.id } })).toBe(0);
    expect(await db!.pendingContribution.count({ where: { asset: { portfolioId: user.portfolio!.id } } })).toBe(0);
    expect(await db!.assetHolding.findMany({ where: { asset: { portfolioId: user.portfolio!.id } } })).toEqual(before);
  });
  it("rejects subcent input before storing a differently rounded native amount", async () => {
    const user = await fixture();
    for (const currency of ["BRL", "USD"] as const) {
      await expect(calculateContributionAction(1.001, currency, "ALL_ASSETS")).rejects.toThrow("duas casas decimais");
    }
    expect(await db!.pendingContribution.count({ where: { userId: user.id } })).toBe(0);
  });
  it("records successive purchases from one calculation without saving its unused suggestions", async () => {
    const user = await fixture();
    await db!.asset.create({ data: {
      portfolioId: user.portfolio!.id, ticker: "SECOND3", name: "Second", score: 10,
      investmentClass: "BRAZILIAN_STOCKS", instrumentType: "STOCK",
      holdings: { create: { issuer: "Synthetic", productName: "Second", quantity: 10, unitPrice: 25,
        currency: "BRL", pricingSource: "MANUAL", positionSource: "MANUAL" } },
    } });
    const preview = await calculateContributionAction(1000);
    expect(preview.suggestions).toHaveLength(2);
    expect(await db!.pendingContribution.count({ where: { userId: user.id } })).toBe(0);
    for (const suggestion of preview.suggestions) {
      const request = { assetId: suggestion.assetId, quantity: Number(suggestion.quantity),
        paidUnitPrice: 25, fxRateToBrl: null };
      await expect(recordContributionAction(request)).resolves.toMatchObject({ awaitingSync: false });
      const holding = await db!.assetHolding.findFirstOrThrow({ where: { assetId: suggestion.assetId } });
      expect(holding.quantity.toNumber()).toBe(10 + Number(suggestion.quantity));
      expect(await db!.pendingContribution.count({ where: { userId: user.id } })).toBe(0);

    }
  });
  it("keeps a displayed purchase usable after changes to quotes, targets and calculation method", async () => {
    const user = await fixture();
    const preview = await calculateContributionAction(100);
    const suggestion = preview.suggestions[0];
    await saveAllocationMethodAction("CERRADO");
    await db!.investmentTarget.updateMany({ where: { userId: user.id }, data: { percentage: 0 } });
    await db!.assetHolding.updateMany({ where: { assetId: suggestion.assetId }, data: { unitPrice: 30 } });
    await expect(recordContributionAction({ assetId: suggestion.assetId,
      quantity: 4, paidUnitPrice: 25, fxRateToBrl: null,
    })).resolves.toMatchObject({ awaitingSync: false });
    expect((await db!.assetHolding.findFirstOrThrow({ where: { assetId: suggestion.assetId } })).quantity.toString()).toBe("14");
    expect(suggestion.quantity).toBe("4");
  });
  it("rejects another user's asset without recording a purchase", async () => {
    const user = await fixture(); const other = await fixture();
    const asset = await db!.asset.findFirstOrThrow({ where: { portfolioId: other.portfolio!.id } });
    caller.id = user.id;
    await expect(recordContributionAction({ assetId: asset.id, quantity: 4,
      paidUnitPrice: 25, fxRateToBrl: null,
    })).rejects.toThrow("não está mais disponível");
    expect(await db!.pendingContribution.count({ where: { userId: user.id } })).toBe(0);
    expect((await db!.assetHolding.findFirstOrThrow({ where: { assetId: asset.id } })).quantity.toString()).toBe("10");
  });
  it("uses the saved method in MCP without saving or provisioning domain records", async () => {
    const user = await fixture(); await saveAllocationMethodAction("CERRADO");
    const before = await db!.pendingContribution.count({ where: { userId: user.id } });
    const preview = await portfolioTools.find((t) => t.name === "preview_contribution")!.execute({
      userId: user.id, scopes: ["portfolio:read"], clientId: "test", grantId: "test", timeZone: "America/Sao_Paulo",
    }, { amount: "100", currency: "BRL", allocationScope: "BRL_ONLY" });
    expect(preview).toMatchObject({ status: "PREVIEW", saved: false, allocationMethod: "CERRADO" });
    const ui = await calculateContributionAction(100, "BRL", "BRL_ONLY");
    expect((preview.suggestions as Array<{ assetId: string; valueBrl: string }>).map((s: { assetId: string; valueBrl: string }) => [s.assetId, s.valueBrl]))
      .toEqual(ui.suggestions.map((s) => [s.assetId, s.value]));
    expect(await db!.pendingContribution.count({ where: { userId: user.id } })).toBe(before);
  });
  it("passes the same currency-scope target cap through UI and MCP Cerrado calculations", async () => {
    const user = await fixture();
    await db!.investmentTarget.updateMany({ where: { userId: user.id }, data: { percentage: 15 } });
    await db!.investmentTarget.create({ data: { userId: user.id, investmentClass: "INTERNATIONAL_STOCKS", percentage: 85 } });
    await db!.assetHolding.updateMany({ where: { asset: { portfolioId: user.portfolio!.id } }, data: { quantity: 1000, unitPrice: 1 } });
    await db!.asset.create({ data: { portfolioId: user.portfolio!.id, ticker: "EXCLUDED", name: "Excluded USD position", score: 10,
      investmentClass: "INTERNATIONAL_STOCKS", instrumentType: "STOCK", marketRegion: "INTERNATIONAL", holdings: { create: {
        issuer: "Synthetic", productName: "Synthetic", quantity: 8000, unitPrice: 1, currency: "USD", pricingSource: "YAHOO", positionSource: "MANUAL",
        fxRateToBrl: 1, fxUpdatedAt: new Date(),
      } } } });
    await saveAllocationMethodAction("CERRADO");
    const preview = await portfolioTools.find((t) => t.name === "preview_contribution")!.execute({
      userId: user.id, scopes: ["portfolio:read"], clientId: "test", grantId: "test", timeZone: "America/Sao_Paulo",
    }, { amount: "1000", currency: "BRL", allocationScope: "BRL_ONLY" });
    const ui = await calculateContributionAction(1000, "BRL", "BRL_ONLY");
    expect(ui.suggestions).toHaveLength(1);
    expect(ui.suggestions[0].value).toBe("411");
    expect((preview.suggestions as Array<{ assetId: string; valueBrl: string }>).map((s) => [s.assetId, s.valueBrl]))
      .toEqual(ui.suggestions.map((s) => [s.assetId, s.value]));
  });
  for (const method of ["IMPROVED", "CERRADO"] as const) for (const currency of ["BRL", "USD"] as const) {
    it(`${method} returns and shares both ${currency}-only budget policies with MCP`, async () => {
      const user = await fixture();
      const selected = currency === "BRL" ? "BRAZILIAN_STOCKS" : "INTERNATIONAL_STOCKS";
      const other = currency === "BRL" ? "INTERNATIONAL_STOCKS" : "BRAZILIAN_STOCKS";
      await db!.investmentTarget.deleteMany({ where: { userId: user.id } });
      await db!.investmentTarget.createMany({ data: [
        { userId: user.id, investmentClass: selected, percentage: 15 },
        { userId: user.id, investmentClass: other, percentage: 85 },
      ] });
      await db!.asset.deleteMany({ where: { portfolioId: user.portfolio!.id } });
      for (const eligible of [true, false]) {
        const native = eligible ? currency : currency === "BRL" ? "USD" : "BRL";
        await db!.asset.create({ data: { portfolioId: user.portfolio!.id, ticker: eligible ? "ELIGIBLE" : "EXCLUDED", name: "Synthetic", score: 10,
          investmentClass: eligible ? selected : other, instrumentType: "STOCK", marketRegion: native === "USD" ? "INTERNATIONAL" : "BRAZIL",
          holdings: { create: { issuer: "Synthetic", productName: "Synthetic", quantity: eligible ? 1000 : 8000, unitPrice: 1,
            currency: native, pricingSource: native === "USD" ? "YAHOO" : "MANUAL", positionSource: "MANUAL", fxRateToBrl: 1, fxUpdatedAt: new Date() } },
        } });
      }
      await saveAllocationMethodAction(method);
      const before = await db!.assetHolding.findMany({ where: { asset: { portfolioId: user.portfolio!.id } } });
      let cappedAmount = "";
      let remainderBudget = "";
      for (const budgetPolicy of ["TARGET_CAPPED", "FULL_BUDGET"] as const) {
        const scope = currency === "USD" ? "USD_ONLY" : "BRL_ONLY";
        const ui = await calculateContributionAction(1000, currency, scope, budgetPolicy);
        const preview = await portfolioTools.find((t) => t.name === "preview_contribution")!.execute({
          userId: user.id, scopes: ["portfolio:read"], clientId: "test", grantId: "test", timeZone: "America/Sao_Paulo",
        }, { amount: "1000", currency, allocationScope: scope, budgetPolicy });
        expect(ui.budgetPolicy).toBe(budgetPolicy);
        expect(ui.calculation).toMatchObject({ budgetPolicy, originalTargets: { [selected]: "15" } });
        expect(ui.suggestions).toHaveLength(1);
        const spent = Number(ui.suggestions[0].value);
        expect(spent).toBeLessThanOrEqual(1000);
        expect(spent).toBeGreaterThanOrEqual(budgetPolicy === "FULL_BUDGET" ? 999.99 : 410);
        if (budgetPolicy === "TARGET_CAPPED") {
          expect(spent).toBeLessThan(413);
          cappedAmount = ui.suggestions[0].value;
          remainderBudget = ui.unallocatedAmount;
        } else {
          expect(ui.calculation).toMatchObject({ budgetStages: { cappedAmount, remainderBudget } });
          expect(ui.calculation.budgetStages).toEqual((preview.calculation as typeof ui.calculation).budgetStages);
          expect(spent).toBeGreaterThanOrEqual(Number(cappedAmount));
        }
        expect(preview).toMatchObject({ status: "PREVIEW", budgetPolicy });
        expect((preview.suggestions as Array<{ assetId: string; valueBrl: string }>).map((s) => [s.assetId, s.valueBrl]))
          .toEqual(ui.suggestions.map((s) => [s.assetId, s.value]));
      }
      expect(await db!.assetHolding.findMany({ where: { asset: { portfolioId: user.portfolio!.id } } })).toEqual(before);
    });
  }
  it("defaults the policy to capped and rejects unknown policies before persisting", async () => {
    const user = await fixture();
    const result = await calculateContributionAction(100);
    expect(result.budgetPolicy).toBe("TARGET_CAPPED");
    await expect(calculateContributionAction(100, "BRL", "BRL_ONLY", "INVALID" as never)).rejects.toThrow();
    await expect(portfolioTools.find((t) => t.name === "preview_contribution")!.execute({
      userId: user.id, scopes: ["portfolio:read"], clientId: "test", grantId: "test", timeZone: "America/Sao_Paulo",
    }, { amount: "100", budgetPolicy: "INVALID" })).rejects.toThrow();
    expect(await db!.pendingContribution.count({ where: { userId: user.id } })).toBe(0);
  });

});
