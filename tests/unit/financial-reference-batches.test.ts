import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { financialReferenceForTimeZone } from "@/lib/calendar";
import type { UserOperationLeaseContext } from "@/lib/operation-security";
import {
  type FinancialReferenceSettings,
  writeFinancialReferenceBatches,
} from "@/features/finance/financial-reference";

describe("snapshot das regras financeiras nos lotes de importação", () => {
  const queryRaw = vi.fn();
  const findProfile = vi.fn();
  const findPreference = vi.fn();
  const runFencedTransaction = vi.fn();
  const lease = { runFencedTransaction } as unknown as UserOperationLeaseContext;
  const tx = {
    $queryRaw: queryRaw,
    financeProfile: { findUnique: findProfile },
    userPreference: { findUnique: findPreference },
  } as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    vi.resetAllMocks();
    queryRaw.mockResolvedValue([{ id: "user-a" }]);
    findProfile.mockResolvedValue({ financialMonthStart: 15 });
    findPreference.mockResolvedValue({ timeZone: "America/Sao_Paulo" });
    runFencedTransaction.mockImplementation(async (action) => action(tx));
  });

  it("obtém lock e lê ambas as configurações dentro do lease antes de escrever", async () => {
    let transactionOpen = false;
    runFencedTransaction.mockImplementation(async (action) => {
      transactionOpen = true;
      try { return await action(tx); } finally { transactionOpen = false; }
    });
    for (const read of [queryRaw, findProfile, findPreference]) {
      const result = read === queryRaw ? [{ id: "user-a" }]
        : read === findProfile ? { financialMonthStart: 15 } : { timeZone: "America/Sao_Paulo" };
      read.mockImplementation(async () => {
        expect(transactionOpen).toBe(true);
        return result;
      });
    }
    const write = vi.fn(async (writeTx: Prisma.TransactionClient, settings: FinancialReferenceSettings) => {
      expect(transactionOpen).toBe(true);
      expect(writeTx).toBe(tx);
      expect(settings).toEqual({ financialMonthStart: 15, timeZone: "America/Sao_Paulo" });
    });

    await writeFinancialReferenceBatches(lease, "user-a", [write]);

    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(findProfile.mock.invocationCallOrder[0]);
    expect(findPreference.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]);
    expect(findProfile).toHaveBeenCalledWith({ where: { userId: "user-a" }, select: { financialMonthStart: true } });
  });

  it("relê configurações após mudanças entre lotes e preserva o limite de 100", async () => {
    const writes: Array<{ batch: number; reference: { year: number; month: number } }> = [];
    let batch = 0;
    runFencedTransaction.mockImplementation(async (action) => {
      batch += 1;
      await action(tx);
      // A settings action committed after the first batch and before the next one.
      findProfile.mockResolvedValue({ financialMonthStart: 10 });
      findPreference.mockResolvedValue({ timeZone: "America/Noronha" });
    });
    const operations = Array.from({ length: 205 }, () => async (
      _tx: Prisma.TransactionClient,
      settings: { financialMonthStart: number; timeZone: string },
    ) => {
      writes.push({
        batch,
        reference: financialReferenceForTimeZone(
          new Date("2026-10-15T02:30:00Z"), settings.financialMonthStart, settings.timeZone,
        ),
      });
    });

    await writeFinancialReferenceBatches(lease, "user-a", operations);

    expect(runFencedTransaction).toHaveBeenCalledTimes(3);
    expect(queryRaw).toHaveBeenCalledTimes(3);
    expect(findProfile).toHaveBeenCalledTimes(3);
    expect(findPreference).toHaveBeenCalledTimes(3);
    expect(writes.filter((write) => write.batch === 1)).toHaveLength(100);
    expect(writes.filter((write) => write.batch === 2)).toHaveLength(100);
    expect(writes.filter((write) => write.batch === 3)).toHaveLength(5);
    expect(writes.slice(0, 100).every((write) => write.reference.month === 9)).toBe(true);
    expect(writes.slice(100).every((write) => write.reference.month === 10)).toBe(true);
  });

  it("não usa configurações capturadas antes da resposta da rede", async () => {
    // The user changed settings while a provider/FX request was in progress.
    findProfile.mockResolvedValue({ financialMonthStart: 20 });
    findPreference.mockResolvedValue({ timeZone: "America/Rio_Branco" });
    const write = vi.fn(async () => undefined);

    await writeFinancialReferenceBatches(lease, "user-a", [write]);

    expect(write).toHaveBeenCalledWith(tx, { financialMonthStart: 20, timeZone: "America/Rio_Branco" });
  });

  it("não escreve nem lê configurações quando o lock falha", async () => {
    queryRaw.mockRejectedValue(new Error("Lock indisponível"));
    const write = vi.fn(async () => undefined);
    await expect(writeFinancialReferenceBatches(lease, "user-a", [write])).rejects.toThrow("Lock indisponível");
    expect(write).not.toHaveBeenCalled();
    expect(findProfile).not.toHaveBeenCalled();
  });

  it("propaga perda do lease sem executar o lote", async () => {
    runFencedTransaction.mockRejectedValue(new Error("Lease perdido"));
    const write = vi.fn(async () => undefined);
    await expect(writeFinancialReferenceBatches(lease, "user-a", [write])).rejects.toThrow("Lease perdido");
    expect(queryRaw).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("não abre transação para um snapshot vazio", async () => {
    await writeFinancialReferenceBatches(lease, "user-a", []);
    expect(runFencedTransaction).not.toHaveBeenCalled();
  });
});
