import { prisma } from "@/lib/prisma";
import { resolvePluggyInstitutionLogo } from "./institution-logo";

type CurrencyAmount = {
  amount: string | number;
  currencyCode: string | null | undefined;
};

export function sumAmountsByCurrency(values: CurrencyAmount[]) {
  return values.reduce<Record<string, number>>((totals, value) => {
    const amount = Number(value.amount);
    if (!Number.isFinite(amount)) return totals;
    const currency = value.currencyCode?.trim().toUpperCase() || "BRL";
    totals[currency] = (totals[currency] ?? 0) + amount;
    return totals;
  }, {});
}

export async function getOpenFinanceData(userId: string) {
  const [items, preference, financialAccounts] = await Promise.all([
    prisma.pluggyItem.findMany({
      where: { userId },
      orderBy: { connectorName: "asc" },
      include: {
        accounts: {
          orderBy: [{ type: "asc" }, { name: "asc" }],
          include: {
            transactions: {
              orderBy: [{ date: "desc" }, { createdAt: "desc" }],
              take: 100,
            },
          },
        },
        investments: {
          orderBy: [{ type: "asc" }, { name: "asc" }],
          include: {
            transactions: {
              orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            },
          },
        },
      },
    }),
    prisma.userPreference.findUnique({
      where: { userId },
      select: {
        showSoldInvestments: true,
        pluggyClientIdCiphertext: true,
        pluggyClientSecretCiphertext: true,
        pluggyWebhookSecretCiphertext: true,
      },
    }),
    prisma.financialAccount.findMany({
      where: {
        userId,
        source: "PLUGGY",
        providerItemId: { not: null },
        active: true,
      },
      select: {
        externalId: true,
        providerItemId: true,
        bankCode: true,
      },
    }),
  ]);

  const bankCodesByItem = new Map<string, Array<string | null>>();
  const activePluggyAccountIds = new Set(
    financialAccounts.flatMap((account) => account.externalId ? [account.externalId] : []),
  );
  for (const account of financialAccounts) {
    if (!account.providerItemId) continue;
    const bankCodes = bankCodesByItem.get(account.providerItemId) ?? [];
    bankCodes.push(account.bankCode);
    bankCodesByItem.set(account.providerItemId, bankCodes);
  }
  const itemLogo = (item: (typeof items)[number]) =>
    resolvePluggyInstitutionLogo(
      item.connectorImageUrl,
      bankCodesByItem.get(item.pluggyItemId) ?? [],
    );
  const connectedItems = items.filter((item) => item.status !== "DELETED");

  const accounts = connectedItems.flatMap((item) =>
    item.accounts.filter((account) => activePluggyAccountIds.has(account.pluggyAccountId)).map((account) => ({
      id: account.id,
      pluggyAccountId: account.pluggyAccountId,
      itemId: item.pluggyItemId,
      institution: item.institutionName || item.connectorName,
      institutionImageUrl: itemLogo(item),
      type: account.type,
      subtype: account.subtype,
      name: account.marketingName || account.name,
      numberLastFour: account.numberLastFour,
      balance: account.balance.toString(),
      currencyCode: account.currencyCode,
      updatedAt: (account.providerUpdatedAt ?? account.updatedAt).toISOString(),
    })),
  );

  const transactions = connectedItems
    .flatMap((item) =>
      item.accounts.filter((account) => activePluggyAccountIds.has(account.pluggyAccountId)).flatMap((account) =>
        account.transactions.map((transaction) => ({
          id: transaction.id,
          institution: item.institutionName || item.connectorName,
          accountName: account.marketingName || account.name,
          description: transaction.description,
          amount: transaction.amount.toString(),
          currencyCode: transaction.currencyCode,
          date: transaction.date.toISOString(),
          type: transaction.type,
          status: transaction.status,
          category: transaction.category,
          merchantName: transaction.merchantName,
        })),
      ),
    )
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 200);

  const investments = items.flatMap((item) =>
    item.investments.map((investment) => ({
      id: investment.id,
      institution: item.institutionName || item.connectorName,
      investmentInstitution: investment.institutionName,
      institutionImageUrl: itemLogo(item),
      name: investment.name,
      code: investment.code,
      isin: investment.isin,
      type: investment.type,
      subtype: investment.subtype,
      balance: investment.balance.toString(),
      value: investment.value?.toString() ?? null,
      quantity: investment.quantity?.toString() ?? null,
      amount: investment.amount?.toString() ?? null,
      taxes: investment.taxes?.toString() ?? null,
      taxes2: investment.taxes2?.toString() ?? null,
      amountProfit: investment.amountProfit?.toString() ?? null,
      amountWithdrawal: investment.amountWithdrawal?.toString() ?? null,
      amountOriginal: investment.amountOriginal?.toString() ?? null,
      lastMonthRate: investment.lastMonthRate?.toString() ?? null,
      annualRate: investment.annualRate?.toString() ?? null,
      lastTwelveMonthsRate: investment.lastTwelveMonthsRate?.toString() ?? null,
      currencyCode: investment.currencyCode,
      quotaDate: investment.quotaDate?.toISOString() ?? null,
      owner: investment.owner,
      number: investment.number,
      institutionNumber: investment.institutionNumber,
      insurerName: investment.insurerName,
      insurerCnpj: investment.insurerCnpj,
      issuer: investment.issuer,
      issuerCnpj: investment.issuerCnpj,
      rate: investment.rate?.toString() ?? null,
      rateType: investment.rateType,
      fixedAnnualRate: investment.fixedAnnualRate?.toString() ?? null,
      purchaseDate: investment.purchaseDate?.toISOString() ?? null,
      dueDate: investment.dueDate?.toISOString() ?? null,
      issueDate: investment.issueDate?.toISOString() ?? null,
      gracePeriodDate: investment.gracePeriodDate?.toISOString() ?? null,
      metadata: investment.metadata,
      status: investment.status,
      providerAvailable: investment.providerAvailable,
      updatedAt: (investment.providerUpdatedAt ?? investment.updatedAt).toISOString(),
      transactions: investment.transactions.map((transaction) => ({
        id: transaction.id,
        description: transaction.description,
        type: transaction.type,
        movementType: transaction.movementType,
        quantity: transaction.quantity?.toString() ?? null,
        value: transaction.value?.toString() ?? null,
        amount: transaction.amount?.toString() ?? null,
        netAmount: transaction.netAmount?.toString() ?? null,
        agreedRate: transaction.agreedRate?.toString() ?? null,
        brokerageNumber: transaction.brokerageNumber,
        date: transaction.date.toISOString(),
        tradeDate: transaction.tradeDate?.toISOString() ?? null,
        expenses: transaction.expenses,
      })),
    })),
  );
  const cashByCurrency = sumAmountsByCurrency(
    accounts
      .filter((account) => account.type !== "CREDIT")
      .map((account) => ({ amount: account.balance, currencyCode: account.currencyCode })),
  );
  const creditByCurrency = sumAmountsByCurrency(
    accounts
      .filter((account) => account.type === "CREDIT")
      .map((account) => ({ amount: account.balance, currencyCode: account.currencyCode })),
  );
  const investmentsByCurrency = sumAmountsByCurrency(
    investments
      .filter((investment) => investment.status === "ACTIVE" && investment.providerAvailable)
      .map((investment) => ({ amount: investment.balance, currencyCode: investment.currencyCode })),
  );

  return {
    configured: Boolean(
      preference?.pluggyClientIdCiphertext &&
        preference.pluggyClientSecretCiphertext,
    ),
    webhookConfigured: Boolean(preference?.pluggyWebhookSecretCiphertext),
    items: items.map((item) => ({
      id: item.id,
      pluggyItemId: item.pluggyItemId,
      connectorName: item.institutionName || item.connectorName,
      connectorImageUrl: itemLogo(item),
      connectorPrimaryColor: item.connectorPrimaryColor,
      status: item.status,
      executionStatus: item.executionStatus,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      consentExpiresAt: item.consentExpiresAt?.toISOString() ?? null,
      providerUpdatedAt: item.providerUpdatedAt?.toISOString() ?? null,
      lastSyncAt: item.lastSyncAt?.toISOString() ?? null,
      syncPending: item.syncPending,
      accountCount: item.accounts.length,
      investmentCount: item.investments.length,
    })),
    pendingDisconnections: items
      .filter((item) => item.status === "DELETED" && item.disconnectionResolution === "PENDING")
      .map((item) => ({
        id: item.id,
        connectorName: item.institutionName || item.connectorName,
        connectorImageUrl: itemLogo(item),
        disconnectedAt: item.disconnectedAt?.toISOString() ?? item.updatedAt.toISOString(),
        investmentCount: item.investments.filter((investment) => investment.status === "ACTIVE").length,
      })),
    accounts,
    transactions,
    investments,
    showSoldInvestments: preference?.showSoldInvestments ?? false,
    soldInvestmentCount: investments.filter((investment) =>
      investment.status === "TOTAL_WITHDRAWAL",
    ).length,
    totals: {
      cash: cashByCurrency.BRL ?? 0,
      credit: creditByCurrency.BRL ?? 0,
      investments: investmentsByCurrency.BRL ?? 0,
    },
    totalsByCurrency: {
      cash: cashByCurrency,
      credit: creditByCurrency,
      investments: investmentsByCurrency,
    },
  };
}

export type OpenFinanceData = Awaited<ReturnType<typeof getOpenFinanceData>>;
