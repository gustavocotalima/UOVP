import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireUserId: mocks.requireUserId }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/features/finance/setup", () => ({ ensureFinanceSetup: vi.fn() }));
vi.mock("@/features/finance/account-investments", () => ({
  projectAccountInvestment: vi.fn(), setAccountInvestmentPreference: vi.fn(),
}));
vi.mock("@/features/finance/account-fx", () => ({
  financialFxRequired: vi.fn(), resolveCurrentFinancialFx: vi.fn(), resolveHistoricalFinancialFx: vi.fn(),
}));
vi.mock("@/features/finance/classification-service", () => ({
  classifyFinanceTransactionsForUser: vi.fn(), learnFinanceClassificationRule: vi.fn(),
}));

import { setFinanceTransactionsIgnoredAction } from "@/features/finance/actions";

describe("alteração em lote de transações ignoradas", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireUserId.mockResolvedValue("user-a");
    mocks.updateMany.mockResolvedValue({ count: 2 });
    mocks.transaction.mockImplementation(async (operation) => operation({
      financeTransaction: { updateMany: mocks.updateMany },
    }));
  });

  it.each([true, false])("deduplica os IDs e valida a alteração para ignored=%s", async (ignored) => {
    await setFinanceTransactionsIgnoredAction(["one", "two", "one"], ignored);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-a", id: { in: ["one", "two"] }, deleted: false },
      data: { ignored },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/transacoes");
  });

  it("propaga a contagem inválida para a transação sem revalidar", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(setFinanceTransactionsIgnoredAction(["one", "missing"], true))
      .rejects.toThrow("Uma ou mais transações são inválidas.");

    // The callback must reject: throwing only after $transaction would commit the partial update.
    await expect(mocks.transaction.mock.results[0].value).rejects.toThrow("Uma ou mais transações são inválidas.");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("revalida somente após o commit", async () => {
    let finishCommit!: () => void;
    const commitPending = new Promise<void>((resolve) => { finishCommit = resolve; });
    mocks.transaction.mockImplementation(async (operation) => {
      await operation({ financeTransaction: { updateMany: mocks.updateMany } });
      await commitPending;
    });
    const action = setFinanceTransactionsIgnoredAction(["one", "two"], true);
    // Wait until the update has completed and the transaction is waiting for its commit.
    await vi.waitFor(() => expect(mocks.updateMany).toHaveBeenCalledOnce());
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    finishCommit();
    await action;
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/transacoes");
  });

  it("não revalida quando o banco falha", async () => {
    mocks.updateMany.mockRejectedValue(new Error("Falha no banco"));
    await expect(setFinanceTransactionsIgnoredAction(["one", "two"], true))
      .rejects.toThrow("Falha no banco");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    { label: "lista vazia", ids: [] },
    { label: "ID vazio", ids: [""] },
    { label: "mais de 500 IDs", ids: Array.from({ length: 501 }, (_, index) => String(index)) },
  ])(
    "rejeita $label antes da transação", async ({ ids }) => {
      await expect(setFinanceTransactionsIgnoredAction(ids, true)).rejects.toThrow();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it("rejeita um boolean inválido antes da transação", async () => {
    await expect(setFinanceTransactionsIgnoredAction(["one"], "true" as unknown as boolean))
      .rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
