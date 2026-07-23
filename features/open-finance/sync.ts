import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveFinancialReference } from "@/features/finance/calculations";
import {
  classifyFinanceTransactionsForUser,
  type FinanceClassificationSummary,
} from "@/features/finance/classification-service";
import {
  getPluggyAccounts,
  getPluggyInvestmentTransactions,
  getPluggyInvestments,
  getPluggyItem,
  getPluggyTransactions,
  type PluggyAccountResponse,
  type PluggyInvestmentTransactionResponse,
  type PluggyInvestmentResponse,
  type PluggyItemResponse,
  type PluggyTransactionResponse,
} from "./pluggy";
import { resolvePluggyTransactionDirection } from "./transaction-direction";
import { reconcilePluggyInvestmentsForUser } from "./diagram-sync";
import {
  requirePluggyCredentials,
  type PluggyCredentials,
} from "./pluggy-credentials";

const WRITE_BATCH_SIZE = 100;
const INVESTMENT_SYNC_CONCURRENCY = 6;

function asDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asDecimal(value: string | number | null | undefined, fallback = "0") {
  if (value === null || value === undefined || value === "") return new Prisma.Decimal(fallback);
  try {
    return new Prisma.Decimal(value);
  } catch {
    return new Prisma.Decimal(fallback);
  }
}

function nullableDecimal(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return new Prisma.Decimal(value);
  } catch {
    return null;
  }
}

function nullableJson(value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function lastFour(value?: string | null) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, "");
  const digits = normalized.replace(/\D/g, "");
  return (digits || normalized).slice(-4) || null;
}

function dayOfMonth(value?: string | null) {
  const date = asDate(value);
  return date ? date.getUTCDate() : null;
}

function parseBankNumber(value?: string | null) {
  if (!value) return { agency: null, accountNumber: null, bankCode: null };
  const parts = value.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return { bankCode: parts[0] ?? null, agency: parts[1] ?? null, accountNumber: parts.slice(2).join("/") };
  }
  if (parts.length === 2) return { bankCode: null, agency: parts[0] ?? null, accountNumber: parts[1] ?? null };
  return { bankCode: null, agency: null, accountNumber: value };
}

function installment(description: string) {
  const match = description.match(/(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?:\s|$)/);
  if (!match) return { installmentNumber: null, installmentTotal: null };
  const installmentNumber = Number(match[1]);
  const installmentTotal = Number(match[2]);
  if (!installmentNumber || !installmentTotal || installmentNumber > installmentTotal) {
    return { installmentNumber: null, installmentTotal: null };
  }
  return { installmentNumber, installmentTotal };
}

function transactionInstallment(transaction: PluggyTransactionResponse) {
  const installmentNumber = transaction.creditCardMetadata?.installmentNumber ?? null;
  const installmentTotal = transaction.creditCardMetadata?.totalInstallments ?? null;
  if (
    installmentNumber
    && installmentTotal
    && installmentNumber <= installmentTotal
  ) {
    return { installmentNumber, installmentTotal };
  }
  return installment(transaction.description);
}

function transactionCounterparty(transaction: PluggyTransactionResponse) {
  if (transaction.type?.toUpperCase() === "DEBIT") {
    return transaction.paymentData?.receiver?.name ?? null;
  }
  if (transaction.type?.toUpperCase() === "CREDIT") {
    return transaction.paymentData?.payer?.name ?? null;
  }
  return transaction.paymentData?.receiver?.name ?? transaction.paymentData?.payer?.name ?? null;
}

function emptyClassificationSummary(): FinanceClassificationSummary {
  return {
    processed: 0,
    metasAssigned: 0,
    tagsAssigned: 0,
    internalTransfersDetected: 0,
    unclassified: 0,
  };
}

function addClassificationSummary(
  target: FinanceClassificationSummary,
  source: FinanceClassificationSummary,
) {
  target.processed += source.processed;
  target.metasAssigned += source.metasAssigned;
  target.tagsAssigned += source.tagsAssigned;
  target.internalTransfersDetected += source.internalTransfersDetected;
  target.unclassified += source.unclassified;
}

function itemData(item: PluggyItemResponse, userId: string) {
  return {
    userId,
    connectorId: item.connector.id,
    connectorName: item.connector.name,
    connectorImageUrl: item.connector.imageUrl ?? null,
    connectorPrimaryColor: item.connector.primaryColor ?? null,
    status: item.status,
    executionStatus: item.executionStatus ?? null,
    errorCode: item.error?.code ?? null,
    errorMessage: item.error?.message ?? null,
    consentExpiresAt: asDate(item.consentExpiresAt),
    providerUpdatedAt: asDate(item.lastUpdatedAt ?? item.updatedAt),
  };
}

async function writeInBatches(operations: Prisma.PrismaPromise<unknown>[]) {
  for (let index = 0; index < operations.length; index += WRITE_BATCH_SIZE) {
    await prisma.$transaction(operations.slice(index, index + WRITE_BATCH_SIZE));
  }
}

async function upsertAccount(pluggyItemDbId: string, account: PluggyAccountResponse) {
  return prisma.pluggyAccount.upsert({
    where: { pluggyAccountId: account.id },
    update: {
      pluggyItemDbId,
      type: account.type,
      subtype: account.subtype ?? null,
      name: account.name,
      marketingName: account.marketingName ?? null,
      numberLastFour: lastFour(account.number),
      balance: asDecimal(account.balance),
      currencyCode: account.currencyCode ?? "BRL",
      providerCreatedAt: asDate(account.createdAt),
      providerUpdatedAt: asDate(account.updatedAt),
    },
    create: {
      pluggyItemDbId,
      pluggyAccountId: account.id,
      type: account.type,
      subtype: account.subtype ?? null,
      name: account.name,
      marketingName: account.marketingName ?? null,
      numberLastFour: lastFour(account.number),
      balance: asDecimal(account.balance),
      currencyCode: account.currencyCode ?? "BRL",
      providerCreatedAt: asDate(account.createdAt),
      providerUpdatedAt: asDate(account.updatedAt),
    },
  });
}

async function upsertFinancialAccount(
  userId: string,
  item: { pluggyItemId: string; institutionName: string | null; connectorName: string; connectorImageUrl: string | null },
  account: PluggyAccountResponse,
  sortOrder: number,
) {
  const bankNumber = parseBankNumber(account.bankData?.transferNumber ?? account.number);
  const type = account.type === "CREDIT" ? "CREDIT_CARD" : "BANK_ACCOUNT";
  const data = {
    userId,
    source: "PLUGGY" as const,
    providerItemId: item.pluggyItemId,
    type: type as "BANK_ACCOUNT" | "CREDIT_CARD",
    subtype: account.subtype ?? null,
    name: account.marketingName ?? account.name,
    institutionName: item.institutionName || item.connectorName,
    institutionImageUrl: item.connectorImageUrl,
    accountNumber: bankNumber.accountNumber,
    agency: bankNumber.agency,
    numberLastFour: lastFour(account.number),
    bankCode: bankNumber.bankCode,
    brand: account.creditData?.brand ?? null,
    balance: asDecimal(account.balance),
    creditLimit: nullableDecimal(account.creditData?.creditLimit),
    availableCredit: nullableDecimal(account.creditData?.availableCreditLimit),
    dueDay: dayOfMonth(account.creditData?.balanceDueDate),
    closingDay: dayOfMonth(account.creditData?.balanceCloseDate),
    currencyCode: account.currencyCode ?? "BRL",
    providerUpdatedAt: asDate(account.updatedAt),
    active: true,
  };
  const { name, ...providerData } = data;
  return prisma.financialAccount.upsert({
    where: { externalId: account.id },
    update: providerData,
    create: { externalId: account.id, sortOrder, name, ...providerData },
  });
}

function transactionOperation(pluggyAccountDbId: string, transaction: PluggyTransactionResponse) {
  const installmentData = transactionInstallment(transaction);
  const data = {
    pluggyAccountDbId,
    description: transaction.description,
    descriptionRaw: transaction.descriptionRaw ?? null,
    amount: asDecimal(transaction.amount),
    amountInAccountCurrency: nullableDecimal(transaction.amountInAccountCurrency),
    balance: nullableDecimal(transaction.balance),
    currencyCode: transaction.currencyCode ?? "BRL",
    date: asDate(transaction.date) ?? new Date(0),
    type: transaction.type ?? null,
    status: transaction.status ?? null,
    category: transaction.category ?? null,
    categoryId: transaction.categoryId ?? null,
    operationType: transaction.operationType ?? null,
    merchantName: transaction.merchant?.name ?? null,
    merchantBusinessName: transaction.merchant?.businessName ?? null,
    merchantCnpj: transaction.merchant?.cnpj ?? null,
    merchantCategory: transaction.merchant?.category ?? null,
    counterpartyName: transactionCounterparty(transaction),
    paymentMethod: transaction.paymentData?.paymentMethod ?? null,
    ...installmentData,
    providerCreatedAt: asDate(transaction.createdAt),
    providerUpdatedAt: asDate(transaction.updatedAt),
  };
  return prisma.pluggyTransaction.upsert({
    where: { pluggyTransactionId: transaction.id },
    update: data,
    create: { pluggyTransactionId: transaction.id, ...data },
  });
}

function financeTransactionOperation(
  userId: string,
  financialAccountId: string,
  transaction: PluggyTransactionResponse,
  financialMonthStart: number,
) {
  const date = asDate(transaction.date) ?? new Date(0);
  const providerAmount = asDecimal(transaction.amount);
  const kind = resolvePluggyTransactionDirection(transaction.type, providerAmount.toNumber());
  const amount = kind === "EXPENSE" ? providerAmount.abs().negated() : providerAmount.abs();
  const installmentData = transactionInstallment(transaction);
  const reference = resolveFinancialReference(date, financialMonthStart);
  const providerData = {
    userId,
    accountId: financialAccountId,
    source: "PLUGGY" as const,
    kind,
    description: transaction.description,
    descriptionRaw: transaction.descriptionRaw ?? null,
    merchantName: transaction.merchant?.name ?? null,
    merchantBusinessName: transaction.merchant?.businessName ?? null,
    merchantCnpj: transaction.merchant?.cnpj ?? null,
    merchantCategory: transaction.merchant?.category ?? null,
    counterpartyName: transactionCounterparty(transaction),
    paymentMethod: transaction.paymentData?.paymentMethod ?? null,
    amount,
    currencyCode: transaction.currencyCode ?? "BRL",
    date,
    providerCategory: transaction.category ?? null,
    providerCategoryId: transaction.categoryId ?? null,
    status: transaction.status ?? null,
    operationType: transaction.operationType ?? null,
    providerUpdatedAt: asDate(transaction.updatedAt),
    ...installmentData,
  };
  return prisma.financeTransaction.upsert({
    where: { externalId: transaction.id },
    update: providerData,
    create: {
      externalId: transaction.id,
      referenceYear: reference.year,
      referenceMonth: reference.month,
      ...providerData,
    },
  });
}

function investmentOperation(pluggyItemDbId: string, investment: PluggyInvestmentResponse) {
  const institution = typeof investment.institution === "object" ? investment.institution : null;
  const institutionName = typeof investment.institution === "string" ? investment.institution : institution?.name ?? null;
  const data = {
    pluggyItemDbId,
    name: investment.name,
    code: investment.code ?? null,
    isin: investment.isin ?? null,
    type: investment.type,
    subtype: investment.subtype ?? null,
    balance: asDecimal(investment.balance),
    value: nullableDecimal(investment.value),
    quantity: nullableDecimal(investment.quantity),
    amount: nullableDecimal(investment.amount),
    taxes: nullableDecimal(investment.taxes),
    taxes2: nullableDecimal(investment.taxes2),
    amountProfit: nullableDecimal(investment.amountProfit),
    amountWithdrawal: nullableDecimal(investment.amountWithdrawal),
    amountOriginal: nullableDecimal(investment.amountOriginal),
    lastMonthRate: nullableDecimal(investment.lastMonthRate),
    annualRate: nullableDecimal(investment.annualRate),
    lastTwelveMonthsRate: nullableDecimal(investment.lastTwelveMonthsRate),
    currencyCode: investment.currencyCode ?? "BRL",
    quotaDate: asDate(investment.date),
    owner: investment.owner ?? null,
    number: investment.number ?? null,
    institutionName,
    institutionNumber: institution?.number ?? null,
    insurerName: institution?.insurer?.name ?? null,
    insurerCnpj: institution?.insurer?.cnpj ?? null,
    issuer: investment.issuer ?? null,
    issuerCnpj: investment.issuerCNPJ ?? null,
    rate: nullableDecimal(investment.rate),
    rateType: investment.rateType ?? null,
    fixedAnnualRate: nullableDecimal(investment.fixedAnnualRate),
    purchaseDate: asDate(investment.purchaseDate),
    dueDate: asDate(investment.dueDate),
    issueDate: asDate(investment.issueDate),
    gracePeriodDate: asDate(investment.gracePeriodDate),
    metadata: nullableJson(investment.metadata),
    status: investment.status ?? null,
    providerAvailable: true,
    providerRemovedAt: null,
    providerCreatedAt: asDate(investment.createdAt),
    providerUpdatedAt: asDate(investment.updatedAt),
  };
  return prisma.pluggyInvestment.upsert({
    where: { pluggyInvestmentId: investment.id },
    update: data,
    create: { pluggyInvestmentId: investment.id, ...data },
  });
}

function investmentTransactionOperation(
  pluggyInvestmentDbId: string,
  transaction: PluggyInvestmentTransactionResponse,
) {
  const data = {
    pluggyInvestmentDbId,
    description: transaction.description ?? null,
    type: transaction.type,
    movementType: transaction.movementType ?? null,
    quantity: nullableDecimal(transaction.quantity),
    value: nullableDecimal(transaction.value),
    amount: nullableDecimal(transaction.amount),
    netAmount: nullableDecimal(transaction.netAmount),
    agreedRate: nullableDecimal(transaction.agreedRate),
    brokerageNumber: transaction.brokerageNumber ?? null,
    date: asDate(transaction.date) ?? new Date(0),
    tradeDate: asDate(transaction.tradeDate),
    expenses: nullableJson(transaction.expenses),
  };
  return prisma.pluggyInvestmentTransaction.upsert({
    where: { pluggyInvestmentTransactionId: transaction.id },
    update: data,
    create: { pluggyInvestmentTransactionId: transaction.id, ...data },
  });
}

async function syncInvestments(
  credentials: PluggyCredentials,
  pluggyItemDbId: string,
  investments: PluggyInvestmentResponse[],
) {
  let transactionCount = 0;
  for (let index = 0; index < investments.length; index += INVESTMENT_SYNC_CONCURRENCY) {
    const batch = investments.slice(index, index + INVESTMENT_SYNC_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (investment) => {
        const storedInvestment = await investmentOperation(pluggyItemDbId, investment);
        const transactions = await getPluggyInvestmentTransactions(credentials, investment.id);
        return { storedInvestment, transactions };
      }),
    );
    for (const { storedInvestment, transactions } of results) {
      await writeInBatches(
        transactions.map((transaction) => investmentTransactionOperation(storedInvestment.id, transaction)),
      );
      await prisma.pluggyInvestmentTransaction.deleteMany({
        where: {
          pluggyInvestmentDbId: storedInvestment.id,
          ...(transactions.length
            ? { pluggyInvestmentTransactionId: { notIn: transactions.map((transaction) => transaction.id) } }
            : {}),
        },
      });
      transactionCount += transactions.length;
    }
  }
  return transactionCount;
}

async function ensureOwnedItem(userId: string, pluggyItemId: string) {
  const item = await prisma.pluggyItem.findFirst({ where: { userId, pluggyItemId } });
  if (!item) throw new Error("Conexão Pluggy não encontrada para este usuário.");
  return item;
}

export async function registerPluggyItemForUser(userId: string, pluggyItemId: string) {
  const credentials = await requirePluggyCredentials(userId);
  const remote = await getPluggyItem(credentials, pluggyItemId);
  const existing = await prisma.pluggyItem.findUnique({ where: { pluggyItemId } });
  if (existing && existing.userId !== userId) throw new Error("Esta conexão já pertence a outro usuário.");
  if (!existing && remote.clientUserId !== userId) throw new Error("A conexão não foi criada para este usuário.");
  return prisma.pluggyItem.upsert({
    where: { pluggyItemId },
    update: itemData(remote, userId),
    create: { pluggyItemId, ...itemData(remote, userId) },
  });
}

export async function bootstrapLegacyPluggyItem(userId: string, pluggyItemId: string) {
  const credentials = await requirePluggyCredentials(userId);
  const remote = await getPluggyItem(credentials, pluggyItemId);
  const existing = await prisma.pluggyItem.findUnique({ where: { pluggyItemId } });
  if (existing && existing.userId !== userId) throw new Error("Esta conexão já pertence a outro usuário.");
  return prisma.pluggyItem.upsert({
    where: { pluggyItemId },
    update: itemData(remote, userId),
    create: { pluggyItemId, ...itemData(remote, userId) },
  });
}

export async function syncPluggyItemForUser(userId: string, pluggyItemId: string) {
  const stored = await ensureOwnedItem(userId, pluggyItemId);
  try {
    const credentials = await requirePluggyCredentials(userId);
    const remote = await getPluggyItem(credentials, pluggyItemId);
    const [accounts, investments] = await Promise.all([
      getPluggyAccounts(credentials, pluggyItemId),
      getPluggyInvestments(credentials, pluggyItemId),
    ]);
    const financialMonthStart =
      (await prisma.financeProfile.findUnique({
        where: { userId },
        select: { financialMonthStart: true },
      }))?.financialMonthStart ?? 1;

    let transactionCount = 0;
    const classification = emptyClassificationSummary();
    for (const [accountIndex, account] of accounts.entries()) {
      const storedAccount = await upsertAccount(stored.id, account);
      const financialAccount = await upsertFinancialAccount(userId, stored, account, accountIndex);
      const transactions = await getPluggyTransactions(credentials, account.id);
      transactionCount += transactions.length;
      await writeInBatches(transactions.map((transaction) => transactionOperation(storedAccount.id, transaction)));
      await writeInBatches(
        transactions.map((transaction) =>
          financeTransactionOperation(userId, financialAccount.id, transaction, financialMonthStart),
        ),
      );
      const externalIds = transactions.map((transaction) => transaction.id);
      for (let index = 0; index < externalIds.length; index += 1_000) {
        const storedTransactions = await prisma.financeTransaction.findMany({
          where: {
            userId,
            accountId: financialAccount.id,
            externalId: { in: externalIds.slice(index, index + 1_000) },
          },
          select: { id: true },
        });
        addClassificationSummary(
          classification,
          await classifyFinanceTransactionsForUser(
            userId,
            storedTransactions.map((transaction) => transaction.id),
          ),
        );
      }
    }

    const investmentTransactionCount = await syncInvestments(credentials, stored.id, investments);
    await prisma.$transaction([
      prisma.financialAccount.updateMany({
        where: {
          userId,
          source: "PLUGGY",
          providerItemId: stored.pluggyItemId,
          externalId: { notIn: accounts.map((account) => account.id) },
        },
        data: { active: false },
      }),
      prisma.pluggyInvestment.updateMany({
        where: {
          pluggyItemDbId: stored.id,
          ...(investments.length ? { pluggyInvestmentId: { notIn: investments.map((investment) => investment.id) } } : {}),
        },
        data: { providerAvailable: false, providerRemovedAt: new Date() },
      }),
      prisma.pluggyItem.update({
        where: { id: stored.id },
        data: {
          ...itemData(remote, userId),
          syncPending: false,
          lastSyncAt: new Date(),
        },
      }),
    ]);

    let diagram = { mapped: 0, review: 0, changed: false };
    try {
      diagram = await reconcilePluggyInvestmentsForUser(userId);
    } catch (error) {
      console.error("Pluggy diagram reconciliation failed", error);
    }

    return {
      accountCount: accounts.length,
      transactionCount,
      investmentCount: investments.length,
      investmentTransactionCount,
      diagram,
      classification,
    };
  } catch (error) {
    await prisma.pluggyItem.update({
      where: { id: stored.id },
      data: {
        syncPending: true,
        errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : "Falha desconhecida na sincronização.",
      },
    });
    throw error;
  }
}

export async function syncAllPluggyItemsForUser(userId: string) {
  const items = await prisma.pluggyItem.findMany({ where: { userId }, select: { pluggyItemId: true } });
  const totals = {
    itemCount: 0,
    accountCount: 0,
    transactionCount: 0,
    investmentCount: 0,
    investmentTransactionCount: 0,
    diagramMappedCount: 0,
    diagramReviewCount: 0,
    classification: emptyClassificationSummary(),
  };
  for (const item of items) {
    const result = await syncPluggyItemForUser(userId, item.pluggyItemId);
    totals.itemCount += 1;
    totals.accountCount += result.accountCount;
    totals.transactionCount += result.transactionCount;
    totals.investmentCount += result.investmentCount;
    totals.investmentTransactionCount += result.investmentTransactionCount;
    totals.diagramMappedCount += result.diagram.mapped;
    totals.diagramReviewCount = result.diagram.review;
    addClassificationSummary(totals.classification, result.classification);
  }
  return totals;
}
