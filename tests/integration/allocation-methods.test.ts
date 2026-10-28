import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";

const caller = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => caller.id }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveAllocationMethodAction } from "@/features/settings/actions";
import { simulateContributionAction, executeContributionAction } from "@/features/portfolio/actions";
import { portfolioTools } from "@/features/mcp/portfolio-tools";

const db = process.env.DATABASE_URL ? new PrismaClient() : null;
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
    expect(saved.calculationVersion).toBe("1");
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
    const completed = await db!.contributionSimulation.update({ where: { id: draft.id }, data: { status: "EXECUTED" } });
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
});
