import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { PluggyAccountResponse, PluggyTransactionResponse } from "@/features/open-finance/pluggy";

const providers = vi.hoisted(() => ({
  item: vi.fn(), accounts: vi.fn(), investments: vi.fn(), transactions: vi.fn(), investmentTransactions: vi.fn(),
  credentials: vi.fn(), currentFx: vi.fn(), historicalFx: vi.fn(), network: vi.fn(),
}));

vi.mock("@/features/open-finance/pluggy", () => ({
  getPluggyItem: providers.item,
  getPluggyAccounts: providers.accounts,
  getPluggyInvestments: providers.investments,
  getPluggyTransactions: providers.transactions,
  getPluggyInvestmentTransactions: providers.investmentTransactions,
}));
vi.mock("@/features/open-finance/pluggy-credentials", () => ({ requirePluggyCredentials: providers.credentials }));
vi.mock("@/features/portfolio/yahoo-finance", () => ({ fetchYahooFxRates: providers.currentFx }));
vi.mock("@/features/finance/fx", () => ({ ensureHistoricalFxRates: providers.historicalFx }));

import { PluggySyncError, syncAllPluggyItemsForUser, syncPluggyItemForUser } from "@/features/open-finance/sync";
import { requestPluggySync } from "@/features/open-finance/sync-requests";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const transactionDate = "2026-10-08T12:00:00Z";
const previousSync = new Date("2026-10-01T12:00:00Z");

suite("ciclo de sincronização Pluggy e falhas intermediárias", () => {
  const users: string[] = [];

  function account(id: string, balance: number): PluggyAccountResponse {
    return {
      id, type: "BANK", name: `Conta ${balance}`, currencyCode: "BRL", balance,
      bankData: { hasReservedBalance: false }, updatedAt: transactionDate,
    };
  }

  function transaction(id: string, amount: number, accountId: string): PluggyTransactionResponse {
    return { id, accountId, description: "Compra de teste", amount, currencyCode: "BRL", type: "DEBIT", date: transactionDate };
  }

  async function fixture() {
    const user = await prisma.user.create({ data: { email: `sync-lifecycle-${randomUUID()}@example.com` } });
    users.push(user.id);
    const item = await prisma.pluggyItem.create({
      data: {
        userId: user.id, pluggyItemId: randomUUID(), connectorName: "Banco de teste", status: "UPDATED",
        syncPending: true, syncRequestedVersion: 1, syncProcessedVersion: 0, lastSyncAt: previousSync,
      },
    });
    const firstAccount = account(randomUUID(), 100);
    const secondAccount = account(randomUUID(), 200);
    const firstTransaction = transaction(randomUUID(), 100, firstAccount.id);
    const secondTransaction = transaction(randomUUID(), 200, secondAccount.id);
    const storedAccounts = await Promise.all([firstAccount, secondAccount].map((snapshot, index) =>
      prisma.financialAccount.create({ data: {
        userId: user.id, externalId: snapshot.id, providerItemId: item.pluggyItemId, source: "PLUGGY",
        type: "BANK_ACCOUNT", name: snapshot.name, currencyCode: "BRL", balance: (index + 1) * 10,
        balanceBrl: (index + 1) * 10,
      } }),
    ));
    await prisma.financeTransaction.create({ data: {
      userId: user.id, accountId: storedAccounts[1].id, source: "PLUGGY", externalId: secondTransaction.id,
      kind: "EXPENSE", description: "Snapshot anterior", amount: -20, reportingAmountBrl: -20,
      currencyCode: "BRL", date: new Date(transactionDate), referenceYear: 2026, referenceMonth: 10,
      providerLifecycle: "ACTIVE",
    } });
    providers.item.mockResolvedValue({
      id: item.pluggyItemId, clientUserId: user.id, status: "UPDATED", connector: { id: 1, name: "Banco de teste" },
    });
    providers.accounts.mockResolvedValue([firstAccount, secondAccount]);
    providers.transactions.mockImplementation(async (_credentials, id: string) => {
      if (id === firstAccount.id) return [firstTransaction];
      if (id === secondAccount.id) return [secondTransaction];
      throw new Error("Conta inesperada no teste.");
    });
    return { user, item, firstAccount, secondAccount, firstTransaction, secondTransaction, storedAccounts };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    providers.credentials.mockResolvedValue({ clientId: "test-client", clientSecret: "test-secret" });
    providers.investments.mockResolvedValue([]);
    providers.investmentTransactions.mockResolvedValue([]);
    providers.currentFx.mockResolvedValue([]);
    providers.historicalFx.mockResolvedValue(new Map());
    providers.network.mockRejectedValue(new Error("A integração de teste não pode acessar a rede."));
    vi.stubGlobal("fetch", providers.network);
  });

  afterEach(() => {
    expect(providers.network).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("reporta commits parciais e o retry converge sem duplicar contas ou transações", async () => {
    const f = await fixture();
    const healthyTransactions = providers.transactions.getMockImplementation()!;
    providers.transactions.mockImplementation(async (credentials, id: string, signal) => {
      if (id === f.secondAccount.id) throw new Error("Falha HTTP na segunda conta.");
      return healthyTransactions(credentials, id, signal);
    });
    await expect(syncPluggyItemForUser(f.user.id, f.item.pluggyItemId)).rejects.toMatchObject({
      name: "PluggySyncError", changed: true, message: "Falha HTTP na segunda conta.",
    });
    const first = await prisma.financialAccount.findUniqueOrThrow({ where: { id: f.storedAccounts[0].id } });
    const second = await prisma.financialAccount.findUniqueOrThrow({ where: { id: f.storedAccounts[1].id } });
    expect(first.balance.toString()).toBe("100");
    expect(second.balance.toString()).toBe("20");
    expect((await prisma.financeTransaction.findUniqueOrThrow({ where: { externalId: f.secondTransaction.id } })).providerLifecycle).toBe("ACTIVE");
    expect(await prisma.financeTransaction.count({ where: { userId: f.user.id } })).toBe(2);
    expect(await prisma.pluggyItem.findUniqueOrThrow({ where: { id: f.item.id } })).toMatchObject({
      syncPending: true, lastSyncAt: previousSync, syncProcessedVersion: 0,
    });
    const failed = await syncAllPluggyItemsForUser(f.user.id);
    expect(failed).toMatchObject({
      changed: true, succeededItemCount: 0, failedItemCount: 1,
      failures: [{ itemId: f.item.pluggyItemId, changed: true }],
    });

    providers.transactions.mockImplementation(healthyTransactions);
    const retried = await syncAllPluggyItemsForUser(f.user.id);
    expect(retried).toMatchObject({ changed: true, succeededItemCount: 1, failedItemCount: 0 });
    expect(await prisma.financialAccount.count({ where: { userId: f.user.id } })).toBe(2);
    expect(await prisma.financeTransaction.count({ where: { userId: f.user.id } })).toBe(2);
    expect(await prisma.pluggyTransaction.count({ where: { account: { item: { userId: f.user.id } } } })).toBe(2);
    expect((await prisma.financialAccount.findUniqueOrThrow({ where: { id: f.storedAccounts[1].id } })).balance.toString()).toBe("200");
    const complete = await prisma.pluggyItem.findUniqueOrThrow({ where: { id: f.item.id } });
    expect(complete).toMatchObject({ syncPending: false, syncProcessedVersion: 1 });
    expect(complete.lastSyncAt!.getTime()).toBeGreaterThan(previousSync.getTime());
  });

  it("preserva o domínio e retorna changed=false quando o primeiro HTTP falha", async () => {
    const f = await fixture();
    const beforeAccounts = await prisma.financialAccount.findMany({ where: { userId: f.user.id }, orderBy: { id: "asc" } });
    const beforeTransactions = await prisma.financeTransaction.findMany({ where: { userId: f.user.id } });
    providers.transactions.mockRejectedValue(new Error("Falha antes do primeiro snapshot."));
    const failure = await syncPluggyItemForUser(f.user.id, f.item.pluggyItemId).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PluggySyncError);
    const result = await syncAllPluggyItemsForUser(f.user.id);
    expect(result).toMatchObject({ changed: false, succeededItemCount: 0, failedItemCount: 1, failures: [{ changed: false }] });
    expect(await prisma.financialAccount.findMany({ where: { userId: f.user.id }, orderBy: { id: "asc" } })).toEqual(beforeAccounts);
    expect(await prisma.financeTransaction.findMany({ where: { userId: f.user.id } })).toEqual(beforeTransactions);
    expect(await prisma.pluggyAccount.count({ where: { item: { userId: f.user.id } } })).toBe(0);
    expect(await prisma.pluggyItem.findUniqueOrThrow({ where: { id: f.item.id } })).toMatchObject({
      syncPending: true, lastSyncAt: previousSync, syncProcessedVersion: 0,
    });
  });

  it("recalcula o valor reportável BRL quando o provedor corrige 100 para 120", async () => {
    const f = await fixture();
    await syncPluggyItemForUser(f.user.id, f.item.pluggyItemId);
    expect((await prisma.financeTransaction.findUniqueOrThrow({ where: { externalId: f.firstTransaction.id } })).reportingAmountBrl!.toString()).toBe("-100");
    const healthyTransactions = providers.transactions.getMockImplementation()!;
    providers.transactions.mockImplementation(async (credentials, id: string, signal) => id === f.firstAccount.id
      ? [{ ...f.firstTransaction, amount: 120 }]
      : healthyTransactions(credentials, id, signal));
    await syncPluggyItemForUser(f.user.id, f.item.pluggyItemId);
    const corrected = await prisma.financeTransaction.findUniqueOrThrow({ where: { externalId: f.firstTransaction.id } });
    expect(corrected.amount.toString()).toBe("-120");
    expect(corrected.reportingAmountBrl!.toString()).toBe("-120");
    expect(corrected.fxSource).toBe("NATIVE");
    expect(corrected.fxRateToBrl!.toString()).toBe("1");
    expect(await prisma.financeTransaction.count({ where: { externalId: f.firstTransaction.id } })).toBe(1);
  });

  it("não reconhece solicitação de webhook recebida durante a coleta HTTP", async () => {
    const f = await fixture();
    const healthyTransactions = providers.transactions.getMockImplementation()!;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const continueHttp = new Promise<void>((resolve) => { release = resolve; });
    providers.transactions.mockImplementationOnce(async (credentials, id: string, signal) => {
      entered();
      await continueHttp;
      return healthyTransactions(credentials, id, signal);
    });
    const pending = syncPluggyItemForUser(f.user.id, f.item.pluggyItemId);
    await started;
    try {
      await prisma.$transaction((tx) => requestPluggySync(tx, { userId: f.user.id, pluggyItemId: f.item.pluggyItemId }));
    } finally { release(); }
    await pending;
    expect(await prisma.pluggyItem.findUniqueOrThrow({ where: { id: f.item.id } })).toMatchObject({
      syncRequestedVersion: 2, syncProcessedVersion: 1, syncPending: true,
    });
    await syncPluggyItemForUser(f.user.id, f.item.pluggyItemId);
    expect(await prisma.pluggyItem.findUniqueOrThrow({ where: { id: f.item.id } })).toMatchObject({
      syncRequestedVersion: 2, syncProcessedVersion: 2, syncPending: false,
    });
  });

  it("aguarda todas as respostas do lote de investimentos e descarta o lote com falha antes de gravar", async () => {
    const f = await fixture();
    providers.accounts.mockResolvedValue([]);
    const firstId = randomUUID();
    const secondId = randomUUID();
    providers.investments.mockResolvedValue([firstId, secondId].map((id) => ({
      id, itemId: f.item.pluggyItemId, type: "EQUITY", name: "Itaú", code: "ITUB3",
      quantity: 2, balance: 100, value: 50, currencyCode: "BRL", status: "ACTIVE",
    })));
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const continueHttp = new Promise<void>((resolve) => { release = resolve; });
    providers.investmentTransactions.mockImplementation(async (_credentials, id: string) => {
      if (id === firstId) throw new Error("Falha de movimentações do investimento.");
      entered();
      await continueHttp;
      return [];
    });
    let settled = false;
    const pending = syncPluggyItemForUser(f.user.id, f.item.pluggyItemId)
      .then((value) => { settled = true; return value; }, (error: unknown) => { settled = true; return error; });
    await started;
    try {
      // A sibling response is still pending. Neither source rows nor holdings
      // may be persisted by work that could outlive the failed operation.
      expect(settled).toBe(false);
      expect(await prisma.pluggyInvestment.count({ where: { pluggyItemDbId: f.item.id } })).toBe(0);
      expect(await prisma.assetHolding.count({ where: { asset: { portfolio: { userId: f.user.id } } } })).toBe(0);
    } finally { release(); }
    const failure = await pending;
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PluggySyncError);
    expect(await prisma.pluggyInvestment.count({ where: { pluggyItemDbId: f.item.id } })).toBe(0);
    expect(await prisma.userOperationLease.findUniqueOrThrow({
      where: { userId_operation: { userId: f.user.id, operation: "pluggy-sync" } },
    })).toMatchObject({ lastRunAt: expect.any(Date) });
  });
});
