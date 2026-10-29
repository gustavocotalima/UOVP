import { createPrismaClient } from "../../lib/prisma-client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";

const caller = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => caller.id }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveAllocationMethodAction } from "@/features/settings/actions";
import { simulateContributionAction, executeContributionAction } from "@/features/portfolio/actions";
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
  it("defaults to Improved and records exact method/version without changing holdings", async () => {
    const user = await fixture();
    expect(user.preference!.allocationMethod).toBe("IMPROVED");
    const before = await db!.assetHolding.findMany({ where: { asset: { portfolioId: user.portfolio!.id } } });
    const result = await simulateContributionAction(100, "BRL", "BRL_ONLY");
    expect(result.allocationMethod).toBe("IMPROVED");
    expect(result.calculation.algorithm).toBe("IMPROVED");
    const saved = await db!.contributionSimulation.findUniqueOrThrow({ where: { id: result.id }, include: { suggestions: true } });
    expect(saved.calculationVersion).toBe(ALLOCATION_VERSIONS.IMPROVED);
    expect(saved.suggestions.reduce((a, s) => a.add(s.value), saved.unallocatedAmount).eq(saved.requestedAmount)).toBe(true);
    expect(await db!.assetHolding.findMany({ where: { asset: { portfolioId: user.portfolio!.id } } })).toEqual(before);
  });
  it("rejects subcent input before storing a differently rounded native amount", async () => {
    const user = await fixture();
    for (const currency of ["BRL", "USD"] as const) {
      await expect(simulateContributionAction(1.001, currency, "ALL_ASSETS")).rejects.toThrow("duas casas decimais");
    }
    expect(await db!.contributionSimulation.count({ where: { userId: user.id } })).toBe(0);
  });
  it("requires recalculation of an old Improved draft instead of executing v1 quantities", async () => {
    const user = await fixture();
    const result = await simulateContributionAction(100);
    await db!.contributionSimulation.update({ where: { id: result.id }, data: { calculationVersion: "1" } });
    const before = await db!.assetHolding.findMany({ where: { asset: { portfolioId: user.portfolio!.id } } });
    expect(await executeContributionAction(result.id)).toEqual({ status: "INVALIDATED" });
    expect(await db!.assetHolding.findMany({ where: { asset: { portfolioId: user.portfolio!.id } } })).toEqual(before);
  });
  it("isolates preferences, rejects invalid methods and invalidates only the caller's drafts", async () => {
    const a = await fixture(); const b = await fixture();
    caller.id = a.id; const draft = await simulateContributionAction(100);
    caller.id = b.id; const other = await simulateContributionAction(100);
    caller.id = a.id;
    await expect(saveAllocationMethodAction("LEGACY")).rejects.toThrow();
    await saveAllocationMethodAction("CERRADO");
    expect((await db!.userPreference.findUniqueOrThrow({ where: { userId: a.id } })).allocationMethod).toBe("CERRADO");
    expect((await db!.userPreference.findUniqueOrThrow({ where: { userId: b.id } })).allocationMethod).toBe("IMPROVED");
    expect((await db!.contributionSimulation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("STALE");
    expect((await db!.contributionSimulation.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("DRAFT");
    expect(await executeContributionAction(draft.id)).toEqual({ status: "INVALIDATED" });
    expect((await simulateContributionAction(100)).allocationMethod).toBe("CERRADO");
  });
  it("keeps historical executions and awaiting-sync entries when the setting changes", async () => {
    const user = await fixture(); const draft = await simulateContributionAction(100);
    const completed = await db!.contributionSimulation.update({ where: { id: draft.id }, data: { status: "EXECUTED", calculationVersion: "1" } });
    const suggestion = await db!.contributionSuggestion.findFirstOrThrow({ where: { simulationId: draft.id } });
    await db!.contributionSuggestion.update({ where: { id: suggestion.id }, data: { executionStatus: "AWAITING_SYNC", awaitingSyncAt: new Date() } });
    await saveAllocationMethodAction("CERRADO");
    expect(await db!.contributionSimulation.findUniqueOrThrow({ where: { id: draft.id } })).toEqual(completed);
    expect((await db!.contributionSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).executionStatus).toBe("AWAITING_SYNC");
    const v = (await db!.portfolio.findUniqueOrThrow({ where: { userId: user.id } })).version;
    await saveAllocationMethodAction("CERRADO");
    expect((await db!.portfolio.findUniqueOrThrow({ where: { userId: user.id } })).version).toBe(v);
  });
  it("uses the saved method in MCP without saving or provisioning domain records", async () => {
    const user = await fixture(); await saveAllocationMethodAction("CERRADO");
    const before = await db!.contributionSimulation.count({ where: { userId: user.id } });
    const preview = await portfolioTools.find((t) => t.name === "preview_contribution")!.execute({
      userId: user.id, scopes: ["portfolio:read"], clientId: "test", grantId: "test", timeZone: "America/Sao_Paulo",
    }, { amount: "100", currency: "BRL", allocationScope: "BRL_ONLY" });
    expect(preview).toMatchObject({ status: "PREVIEW", saved: false, allocationMethod: "CERRADO" });
    const ui = await simulateContributionAction(100, "BRL", "BRL_ONLY");
    expect((preview.suggestions as Array<{ assetId: string; valueBrl: string }>).map((s: { assetId: string; valueBrl: string }) => [s.assetId, s.valueBrl]))
      .toEqual(ui.suggestions.map((s) => [s.assetId, s.value]));
    expect(await db!.contributionSimulation.count({ where: { userId: user.id } })).toBe(before + 1);
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
    const ui = await simulateContributionAction(1000, "BRL", "BRL_ONLY");
    expect(ui.suggestions).toHaveLength(1);
    expect(ui.suggestions[0].value).toBe("411");
    expect((preview.suggestions as Array<{ assetId: string; valueBrl: string }>).map((s) => [s.assetId, s.valueBrl]))
      .toEqual(ui.suggestions.map((s) => [s.assetId, s.value]));
  });
  for (const method of ["IMPROVED", "CERRADO"] as const) for (const currency of ["BRL", "USD"] as const) {
    it(`${method} persists and shares both ${currency}-only budget policies with MCP`, async () => {
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
        const ui = await simulateContributionAction(1000, currency, scope, budgetPolicy);
        const preview = await portfolioTools.find((t) => t.name === "preview_contribution")!.execute({
          userId: user.id, scopes: ["portfolio:read"], clientId: "test", grantId: "test", timeZone: "America/Sao_Paulo",
        }, { amount: "1000", currency, allocationScope: scope, budgetPolicy });
        const saved = await db!.contributionSimulation.findUniqueOrThrow({ where: { id: ui.id } });
        expect(ui.budgetPolicy).toBe(budgetPolicy);
        expect(saved.calculationDetails).toMatchObject({ budgetPolicy, originalTargets: { [selected]: "15" } });
        expect(ui.suggestions).toHaveLength(1);
        const spent = Number(ui.suggestions[0].value);
        expect(spent).toBeLessThanOrEqual(1000);
        expect(spent).toBeGreaterThanOrEqual(budgetPolicy === "FULL_BUDGET" ? 999.99 : 410);
        if (budgetPolicy === "TARGET_CAPPED") {
          expect(spent).toBeLessThan(413);
          cappedAmount = ui.suggestions[0].value;
          remainderBudget = ui.unallocatedAmount;
        } else {
          expect(saved.calculationDetails).toMatchObject({ budgetStages: { cappedAmount, remainderBudget } });
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
    const result = await simulateContributionAction(100);
    expect(result.budgetPolicy).toBe("TARGET_CAPPED");
    await expect(simulateContributionAction(100, "BRL", "BRL_ONLY", "INVALID" as never)).rejects.toThrow();
    await expect(portfolioTools.find((t) => t.name === "preview_contribution")!.execute({
      userId: user.id, scopes: ["portfolio:read"], clientId: "test", grantId: "test", timeZone: "America/Sao_Paulo",
    }, { amount: "100", budgetPolicy: "INVALID" })).rejects.toThrow();
    expect(await db!.contributionSimulation.count({ where: { userId: user.id } })).toBe(1);
  });
  it.each(["IMPROVED", "CERRADO"] as const)("%s rejects drafts from before the budget-policy update", async (method) => {
    await fixture(); await saveAllocationMethodAction(method);
    const result = await simulateContributionAction(100);
    await db!.contributionSimulation.update({ where: { id: result.id }, data: { calculationVersion: method === "IMPROVED" ? "3" : "2" } });
    expect(await executeContributionAction(result.id)).toEqual({ status: "INVALIDATED" });
  });

  it("the data migration invalidates only incompatible unrecorded drafts", async () => {
    const cases = [
      { method: "IMPROVED", version: "2", recorded: null, expected: "STALE" },
      { method: "CERRADO", version: "1", recorded: null, expected: "STALE" },
      { method: "IMPROVED", version: "3", recorded: null, expected: "DRAFT" },
      { method: "CERRADO", version: "2", recorded: null, expected: "DRAFT" },
      { method: "IMPROVED", version: "2", recorded: "AWAITING_SYNC", expected: "DRAFT" },
      { method: "CERRADO", version: "1", recorded: "EXECUTED", expected: "DRAFT" },
    ] as const;
    const ids: string[] = [];
    for (const item of cases) {
      await fixture(); await saveAllocationMethodAction(item.method);
      const result = await simulateContributionAction(100);
      ids.push(result.id);
      await db!.contributionSimulation.update({ where: { id: result.id }, data: { calculationVersion: item.version } });
      if (item.recorded) await db!.contributionSuggestion.updateMany({ where: { simulationId: result.id }, data: { executionStatus: item.recorded } });
    }
    const sql = readFileSync(new URL("../../prisma/migrations/20261028200000_allocation_budget_policies/migration.sql", import.meta.url), "utf8");
    await db!.$executeRawUnsafe(sql);
    for (const [i, item] of cases.entries()) {
      const saved = await db!.contributionSimulation.findUniqueOrThrow({ where: { id: ids[i] }, include: { suggestions: true } });
      expect(saved.status).toBe(item.expected);
      expect(saved.calculationVersion).toBe(item.version);
      if (item.recorded) expect(saved.suggestions[0].executionStatus).toBe(item.recorded);
    }
  });

});
