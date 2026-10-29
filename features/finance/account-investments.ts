import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { FIXED_INCOME_INDEXATION_META } from "@/features/portfolio/constants";

export const accountInvestmentReviewSchema = z.object({
  linkId: z.string().cuid(),
  expectedUpdatedAt: z.string().datetime(),
  investmentClass: z.enum(["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"]),
  familyCode: z.string().trim().min(1).max(80),
  indexation: z.enum(["PRE_FIXED", "POST_FIXED", "INFLATION", "OTHER"]),
  score: z.number().int().min(-30).max(30),
  catalogItemId: z.number().int().positive().nullable().default(null),
  customTypeName: z.string().trim().max(120).default("Saldo de conta remunerado"),
  rateConvention: z.enum(["FIXED_ANNUAL", "PERCENT_OF_INDEXER", "INDEXER_PLUS", "OTHER"]).nullable().default(null),
  benchmark: z.string().trim().max(32).nullable().default(null),
  rateValue: z.number().finite().min(0).max(100000).nullable().default(null),
  confirmDistinctAutomaticBalance: z.boolean().default(false),
}).superRefine((value, context) => {
  if (!value.catalogItemId && value.customTypeName.length < 2) {
    context.addIssue({ code: "custom", message: "Informe o tipo personalizado do saldo." });
  }
  if (value.rateConvention && value.rateConvention !== "OTHER" && value.rateValue === null) {
    context.addIssue({ code: "custom", message: "Informe a taxa descritiva." });
  }
  if (["PERCENT_OF_INDEXER", "INDEXER_PLUS"].includes(value.rateConvention ?? "") && !value.benchmark) {
    context.addIssue({ code: "custom", message: "Informe o indexador da taxa." });
  }
  if ((!value.rateConvention && (value.rateValue !== null || value.benchmark))
    || (value.rateConvention === "FIXED_ANNUAL" && value.benchmark)) {
    context.addIssue({ code: "custom", message: "A combinação de taxa e indexador é inválida." });
  }
});

/** Identity-based overlap detection: never infer duplication from names or amounts. */
export async function accountAutomaticBalanceConflicts(tx: Prisma.TransactionClient, accountId: string) {
  const account = await tx.financialAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (!account.externalId) return [];
  return tx.pluggyInvestmentDiagramLink.findMany({
    where: {
      userId: account.userId,
      status: "MAPPED",
      holding: { includedInTotals: true },
      investment: {
        source: "ACCOUNT_AUTOMATIC_BALANCE",
        providerAvailable: true,
        sourceAccount: { pluggyAccountId: account.externalId },
      },
    },
    select: { id: true, investment: { select: { name: true } } },
  });
}

/** Call only inside the transaction that mutates/locks the source account. No read-side writes. */
export async function projectAccountInvestment(tx: Prisma.TransactionClient, accountId: string) {
  await tx.$queryRaw`SELECT "id" FROM "FinancialAccount" WHERE "id" = ${accountId} FOR UPDATE`;
  const link = await tx.accountInvestmentLink.findUnique({
    where: { accountId },
    include: { account: true, assetHolding: { include: { asset: { include: { portfolio: { select: { userId: true } } } } } } },
  });
  if (!link) return;
  const { account, assetHolding: holding } = link;
  const currencyChanged = link.classifiedCurrency !== null && link.classifiedCurrency !== account.currencyCode;
  if (currencyChanged && link.status !== "NEEDS_REVIEW") {
    await tx.accountInvestmentLink.update({ where: { id: link.id }, data: { status: "NEEDS_REVIEW" } });
  }
  if (!holding) return;
  if (holding.asset.portfolio.userId !== account.userId) throw new Error("A posição não pertence ao titular da conta.");
  if (holding.positionSource !== "ACCOUNT_BALANCE") throw new Error("O vínculo não corresponde a uma posição de saldo de conta.");
  const balance = Prisma.Decimal.max(account.balance, 0);
  const included = link.enabled && link.status === "MAPPED" && !currencyChanged
    && account.active && account.type === "BANK_ACCOUNT";
  const fx = account.currencyCode === "BRL" ? new Prisma.Decimal(1) : account.balanceFxRateToBrl;
  const validFx = fx?.isFinite() && fx.gt(0) ? fx : null;
  const valueChanged = !holding.quantity.equals(balance) || !holding.currentValue?.equals(balance)
    || holding.includedInTotals !== included || holding.currency !== account.currencyCode
    || (holding.fxRateToBrl?.toString() ?? null) !== (validFx?.toString() ?? null);
  const priceUpdatedAt = account.providerUpdatedAt ?? account.updatedAt;
  const metadataChanged = holding.productName !== account.name || holding.issuer !== (account.institutionName || account.name)
    || holding.fxUpdatedAt?.getTime() !== account.balanceFxRateDate?.getTime()
    || holding.priceUpdatedAt?.getTime() !== priceUpdatedAt.getTime();
  if (!valueChanged && !metadataChanged) return;
  const nativeChanged = holding.currency === account.currencyCode && !holding.quantity.equals(balance);
  await tx.assetHolding.update({
    where: { id: holding.id },
    data: {
      quantity: balance, unitPrice: 1, currentValue: balance, providerCurrentValue: balance,
      investedValue: null, investedValueCurrency: null, includedInTotals: included, currency: account.currencyCode,
      fxRateToBrl: validFx, fxUpdatedAt: account.balanceFxRateDate,
      priceUpdatedAt,
      productName: account.name, issuer: account.institutionName || account.name,
    },
  });
  // FX-only changes must never acknowledge a planned deposit.
  if (included && nativeChanged) {
    await tx.pendingContribution.deleteMany({ where: { userId: account.userId, holdingId: holding.id } });
  }
}

export async function setAccountInvestmentPreference(
  tx: Prisma.TransactionClient, userId: string, accountId: string, enabled?: boolean,
) {
  const account = await tx.financialAccount.findFirstOrThrow({ where: { id: accountId, userId } });
  if (enabled !== undefined) {
    if (enabled && account.type !== "BANK_ACCOUNT") throw new Error("Cartões não podem ser classificados como investimento.");
    if (enabled && !["BRL", "USD"].includes(account.currencyCode)) throw new Error("Esta opção aceita somente contas em BRL ou USD.");
    await tx.accountInvestmentLink.upsert({
      where: { accountId }, create: { accountId, enabled }, update: { enabled },
    });
    await tx.accountInvestmentLink.updateMany({
      where: { accountId, assetHoldingId: null }, data: { status: "NEEDS_REVIEW" },
    });
  }
  if (account.type !== "BANK_ACCOUNT") {
    await tx.accountInvestmentLink.updateMany({ where: { accountId }, data: { enabled: false } });
  }
  await projectAccountInvestment(tx, accountId);
}

export async function classifyAccountInvestment(
  tx: Prisma.TransactionClient, userId: string, input: z.input<typeof accountInvestmentReviewSchema>,
) {
  const parsed = accountInvestmentReviewSchema.parse(input);
  const existing = await tx.accountInvestmentLink.findFirst({ where: { id: parsed.linkId, account: { userId } } });
  if (!existing) throw new Error("Saldo vinculado não encontrado.");
  await tx.$queryRaw`SELECT "id" FROM "FinancialAccount" WHERE "id" = ${existing.accountId} FOR UPDATE`;
  const link = await tx.accountInvestmentLink.findUniqueOrThrow({ where: { id: existing.id }, include: {
    account: true, assetHolding: { select: { asset: { select: { portfolio: { select: { userId: true } } } } } },
  } });
  const account = link.account;
  if (link.assetHolding && link.assetHolding.asset.portfolio.userId !== userId) throw new Error("A posição não pertence ao titular da conta.");
  if (link.updatedAt.toISOString() !== parsed.expectedUpdatedAt) throw new Error("A posição mudou. Atualize a página e revise novamente.");
  if (!link.enabled || !account.active || account.type !== "BANK_ACCOUNT" || account.balance.lte(0)) {
    throw new Error("Ative a opção em uma conta bancária com saldo positivo.");
  }
  const expectedClass = account.currencyCode === "USD" ? "INTERNATIONAL_FIXED_INCOME" : "FIXED_INCOME";
  if (!["BRL", "USD"].includes(account.currencyCode) || parsed.investmentClass !== expectedClass) {
    throw new Error("A classe deve corresponder à moeda da conta (BRL nacional; USD internacional).");
  }
  const conflicts = await accountAutomaticBalanceConflicts(tx, account.id);
  if (conflicts.length && !parsed.confirmDistinctAutomaticBalance && !link.distinctAutomaticBalance) {
    throw new Error("Há um saldo automático desta conta na Carteira. Exclua a representação duplicada ou confirme que os valores são distintos.");
  }
  const family = await tx.fixedIncomeFamily.findUniqueOrThrow({ where: { code: parsed.familyCode } });
  if (parsed.catalogItemId) {
    const catalog = await tx.assetCatalogItem.findUnique({ where: { id: parsed.catalogItemId } });
    if (!catalog || catalog.familyCode !== family.code) throw new Error("O tipo selecionado não pertence à família informada.");
  }
  const portfolio = await tx.portfolio.upsert({ where: { userId }, create: { userId }, update: {} });
  const ticker = `${family.shortCode}-${FIXED_INCOME_INDEXATION_META[parsed.indexation].suffix}`.toUpperCase();
  const existingGroup = await tx.asset.findFirst({ where: {
    portfolioId: portfolio.id, investmentClass: parsed.investmentClass, instrumentType: "FIXED_INCOME",
    fixedIncomeFamilyCode: family.code, indexation: parsed.indexation,
  } });
  const asset = existingGroup ?? await tx.asset.upsert({
    where: { portfolioId_investmentClass_ticker: { portfolioId: portfolio.id, investmentClass: parsed.investmentClass, ticker } },
    // Reusing a group must not overwrite its score or classification.
    update: {},
    create: {
      portfolioId: portfolio.id, ticker, name: `${family.name} · ${FIXED_INCOME_INDEXATION_META[parsed.indexation].label}`,
      instrumentType: "FIXED_INCOME", investmentClass: parsed.investmentClass,
      fixedIncomeFamilyCode: family.code, indexation: parsed.indexation, score: parsed.score,
      instrumentSource: "USER_OVERRIDE", exposureSource: "USER_OVERRIDE", groupSource: "USER_OVERRIDE",
    },
  });
  if (asset.instrumentType !== "FIXED_INCOME" || asset.fixedIncomeFamilyCode !== family.code || asset.indexation !== parsed.indexation) {
    throw new Error("O grupo existente tem outra classificação e não pode ser sobrescrito.");
  }
  const metadata = {
    assetId: asset.id, catalogItemId: parsed.catalogItemId,
    customTypeName: parsed.catalogItemId ? null : parsed.customTypeName,
    rateConvention: parsed.rateConvention, benchmark: parsed.benchmark || null, rateValue: parsed.rateValue,
  };
  const holding = link.assetHoldingId
    ? await tx.assetHolding.update({ where: { id: link.assetHoldingId }, data: metadata })
    : await tx.assetHolding.create({ data: {
        ...metadata, pricingSource: "ACCOUNT_BALANCE", positionSource: "ACCOUNT_BALANCE",
        issuer: account.institutionName || account.name, productName: account.name,
        investedValue: null, investedValueCurrency: null,
        currency: account.currencyCode, includedInTotals: false, fractional: true,
      } });
  await tx.accountInvestmentLink.update({ where: { id: link.id }, data: {
    assetHoldingId: holding.id, status: "MAPPED", classifiedCurrency: account.currencyCode,
    distinctAutomaticBalance: parsed.confirmDistinctAutomaticBalance || link.distinctAutomaticBalance,
  } });
  await projectAccountInvestment(tx, account.id);
  return holding.id;
}
