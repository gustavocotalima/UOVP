import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { portfolioTools } from "@/features/mcp/portfolio-tools";
import type { McpContext } from "@/features/mcp/types";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("MCP portfolio database read-only queries", () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  let userId = "";
  let otherUserId = "";
  let emptyUserId = "";
  let portfolioId = "";
  let holdingId = "";
  let foreignHoldingId = "";
  let connectedHoldingId = "";
  let context: McpContext;

  function execute(name: string, input: Record<string, unknown> = {}, owner = context) {
    return portfolioTools.find((tool) => tool.name === name)!.execute(owner, input);
  }

  beforeAll(async () => {
    const [user, other, empty] = await Promise.all([
      prisma.user.create({ data: { email: `mcp-portfolio-${suffix}@example.com`, portfolio: { create: {} } }, select: { id: true, portfolio: { select: { id: true } } } }),
      prisma.user.create({ data: { email: `mcp-portfolio-other-${suffix}@example.com`, portfolio: { create: {} } }, select: { id: true, portfolio: { select: { id: true } } } }),
      prisma.user.create({ data: { email: `mcp-portfolio-empty-${suffix}@example.com` }, select: { id: true } }),
    ]);
    userId = user.id;
    otherUserId = other.id;
    emptyUserId = empty.id;
    portfolioId = user.portfolio!.id;
    context = { userId, scopes: ["portfolio:read"], clientId: "test", grantId: "test", timeZone: "America/Sao_Paulo" };
    const stock = await prisma.asset.create({
      data: { portfolioId, ticker: "VIVA3", name: "Vivara", instrumentType: "STOCK", investmentClass: "BRAZILIAN_STOCKS", score: 8,
        holdings: { create: { productName: "VIVA3", issuer: "Vivara", pricingSource: "BRAPI", positionSource: "MANUAL", currency: "BRL", quantity: 10, unitPrice: 10 } } },
      select: { holdings: { select: { id: true } } },
    });
    holdingId = stock.holdings[0].id;
    const foreign = await prisma.asset.create({
      data: { portfolioId: other.portfolio!.id, ticker: "PRIVATE", name: "Other user's private investment", instrumentType: "STOCK", investmentClass: "BRAZILIAN_STOCKS",
        holdings: { create: { productName: "Private", issuer: "Private", pricingSource: "MANUAL", quantity: 10, unitPrice: 999 } } },
      select: { holdings: { select: { id: true } } },
    });
    foreignHoldingId = foreign.holdings[0].id;
    const fixed = await prisma.asset.create({
      data: { portfolioId, ticker: "CDB-MCP", name: "Corrected CDB", instrumentType: "FIXED_INCOME", investmentClass: "FIXED_INCOME",
        holdings: { create: { productName: "Corrected CDB", issuer: "Corrected issuer", pricingSource: "PLUGGY", positionSource: "PLUGGY", quantity: 1, currentValue: 100, rateConvention: "FIXED_ANNUAL", rateValue: "14.85" } } },
      select: { holdings: { select: { id: true } } },
    });
    connectedHoldingId = fixed.holdings[0].id;
    const item = await prisma.pluggyItem.create({
      data: { userId, pluggyItemId: `mcp-item-${suffix}`, connectorName: "Inter", institutionName: "Inter", status: "UPDATED", lastSyncAt: new Date(), syncPending: false },
    });
    await prisma.pluggyInvestment.create({
      data: { pluggyItemDbId: item.id, pluggyInvestmentId: `mcp-investment-${suffix}`, name: "Provider CDB", issuer: "Provider issuer", issuerCnpj: "00.000.000/0001-00",
        type: "FIXED_INCOME", subtype: "CDB", balance: 100, quantity: 1, currencyCode: "BRL", rate: "8.95", rateType: "ANNUAL", status: "ACTIVE",
        diagramLink: { create: { userId, assetHoldingId: connectedHoldingId, status: "MAPPED", metadataOverrideFields: ["PRODUCT_NAME", "ISSUER", "RATE_TERMS"], overrideProductName: "Corrected CDB", overrideIssuer: "Corrected issuer", overrideRateValue: "14.85", metadataOverrideUpdatedAt: new Date() } } },
    });
    await prisma.pluggyInvestment.create({
      data: { pluggyItemDbId: item.id, pluggyInvestmentId: `mcp-caixinha-${suffix}`, source: "ACCOUNT_RESERVED_BALANCE", name: "Pending Caixinha", type: "OTHER", balance: 500, status: "ACTIVE",
        diagramLink: { create: { userId, status: "NEEDS_REVIEW" } } },
    });
    await prisma.investmentTarget.create({ data: { userId, investmentClass: "BRAZILIAN_STOCKS", percentage: 100 } });
  });

  afterAll(async () => {
    const userIds = [userId, otherUserId, emptyUserId].filter(Boolean);
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("matches included portfolio totals while keeping pending investments and raw/effective terms separate", async () => {
    const summary = await execute("get_portfolio_summary");
    expect(summary).toMatchObject({ totalValueBrl: "200", complete: true, pendingPluggyReview: 1 });
    const details = await execute("get_holding_details", { holdingId: connectedHoldingId });
    expect(details.holding).toMatchObject({ effectiveMetadata: { productName: "Corrected CDB", issuer: "Corrected issuer", rateValue: "14.85" }, providerMetadata: { productName: "Provider CDB", issuer: "Provider issuer", rate: "8.95" }, overrideFields: ["PRODUCT_NAME", "ISSUER", "RATE_TERMS"] });
    expect(JSON.stringify(details)).not.toContain("00.000.000/0001-00");
    const connected = await execute("list_connected_investments", { mappingStatus: "NEEDS_REVIEW" });
    expect(connected.investments).toEqual([expect.objectContaining({ isCaixinha: true, includedInPortfolioTotals: false, holding: null })]);
  });

  it("rejects cross-user by-ID access and never lists another portfolio", async () => {
    await expect(execute("get_holding_details", { holdingId: foreignHoldingId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(execute("list_holdings", { cursor: foreignHoldingId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(JSON.stringify(await execute("list_holdings"))).not.toContain("Other user's private investment");
  });

  it("marks the full valuation incomplete rather than adding foreign assets with missing FX as zero", async () => {
    const foreignAsset = await prisma.asset.create({
      data: { portfolioId, ticker: "KO", name: "Coca Cola", instrumentType: "STOCK", investmentClass: "INTERNATIONAL_STOCKS",
        holdings: { create: { productName: "KO", issuer: "Coca Cola", pricingSource: "YAHOO", currency: "USD", quantity: 2, unitPrice: 100 } } },
    });
    try {
      expect(await execute("get_portfolio_summary")).toMatchObject({ totalValueBrl: null, knownSubtotalBrl: "200", complete: false });
      expect(await execute("preview_contribution", { amount: "100", currency: "BRL" })).toMatchObject({ status: "UNAVAILABLE", saved: false, reason: "INCOMPLETE_PORTFOLIO_VALUATION" });
    } finally {
      await prisma.asset.delete({ where: { id: foreignAsset.id } });
    }
  });

  it("never provisions a portfolio or questions and never saves preview simulations", async () => {
    const before = await prisma.assetHolding.findUniqueOrThrow({ where: { id: holdingId }, select: { quantity: true, unitPrice: true, updatedAt: true } });
    const preview = await execute("preview_contribution", { amount: "100", currency: "BRL" });
    expect(preview).toMatchObject({ status: "PREVIEW", saved: false, executed: false });
    const after = await prisma.assetHolding.findUniqueOrThrow({ where: { id: holdingId }, select: { quantity: true, unitPrice: true, updatedAt: true } });
    expect(after).toEqual(before);
    expect(await prisma.contributionSimulation.count({ where: { userId } })).toBe(0);
    const emptyContext = { ...context, userId: emptyUserId };
    expect(await execute("get_portfolio_summary", {}, emptyContext)).toMatchObject({ portfolioId: null, totalValueBrl: "0" });
    expect(await prisma.portfolio.count({ where: { userId: emptyUserId } })).toBe(0);
    expect(await prisma.diagramQuestion.count({ where: { userId: emptyUserId } })).toBe(0);
  });
});
