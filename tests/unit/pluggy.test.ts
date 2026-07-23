import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credentials = {
  clientId: "client-id",
  clientSecret: "client-secret",
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cliente Pluggy", () => {
  it("usa o tipo do provedor para normalizar entradas e saídas, inclusive em cartões", async () => {
    const { resolvePluggyTransactionDirection } = await import(
      "@/features/open-finance/transaction-direction"
    );

    expect(resolvePluggyTransactionDirection("DEBIT", 125)).toBe("EXPENSE");
    expect(resolvePluggyTransactionDirection("CREDIT", -125)).toBe("INCOME");
    expect(resolvePluggyTransactionDirection(null, -125)).toBe("EXPENSE");
    expect(resolvePluggyTransactionDirection(undefined, 125)).toBe("INCOME");
  });

  it("pagina transações usando a próxima query opaca fornecida pela Pluggy", async () => {
    const accountId = "11111111-1111-4111-8111-111111111111";
    const firstTransaction = {
      id: "22222222-2222-4222-8222-222222222222",
      accountId,
      description: "Primeiro lançamento",
      amount: -10,
      date: "2026-07-22T12:00:00.000Z",
    };
    const secondTransaction = {
      id: "33333333-3333-4333-8333-333333333333",
      accountId,
      description: "Segundo lançamento",
      amount: 20,
      date: "2026-07-23T12:00:00.000Z",
    };
    const nextQuery = `?accountId=${accountId}&after=opaque%3D`;
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url.endsWith("/auth")) return Response.json({ apiKey: "temporary-api-key" });
      if (url.endsWith(nextQuery)) return Response.json({ results: [secondTransaction], next: null });
      return Response.json({ results: [firstTransaction], next: nextQuery });
    });
    vi.stubGlobal("fetch", fetcher);

    const { getPluggyTransactions } = await import("@/features/open-finance/pluggy");
    const transactions = await getPluggyTransactions(credentials, accountId);

    expect(transactions.map((transaction) => transaction.id)).toEqual([firstTransaction.id, secondTransaction.id]);
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      `https://api.pluggy.ai/v2/transactions${nextQuery}`,
      expect.objectContaining({ headers: expect.objectContaining({ "X-API-KEY": "temporary-api-key" }) }),
    );
  });

  it("carrega todas as páginas de movimentações de um investimento", async () => {
    const investmentId = "44444444-4444-4444-8444-444444444444";
    const firstMovement = {
      id: "movement-1",
      type: "BUY",
      movementType: "CREDIT",
      amount: 1000,
      date: "2026-01-10T12:00:00.000Z",
    };
    const secondMovement = {
      id: "movement-2",
      type: "INTEREST",
      movementType: "DEBIT",
      amount: 25,
      date: "2026-07-10T12:00:00.000Z",
    };
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url.endsWith("/auth")) return Response.json({ apiKey: "temporary-api-key" });
      if (url.endsWith("page=2")) {
        return Response.json({ results: [secondMovement], page: 2, totalPages: 2, total: 2 });
      }
      return Response.json({ results: [firstMovement], page: 1, totalPages: 2, total: 2 });
    });
    vi.stubGlobal("fetch", fetcher);

    const { getPluggyInvestmentTransactions } = await import("@/features/open-finance/pluggy");
    const movements = await getPluggyInvestmentTransactions(credentials, investmentId);

    expect(movements.map((movement) => movement.id)).toEqual(["movement-1", "movement-2"]);
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      `https://api.pluggy.ai/investments/${investmentId}/transactions?pageSize=500&page=2`,
      expect.objectContaining({ headers: expect.objectContaining({ "X-API-KEY": "temporary-api-key" }) }),
    );
  });

  it("gera Connect Token no backend com vínculo ao usuário e prevenção de duplicatas", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      void _init;
      if (String(input).endsWith("/auth")) return Response.json({ apiKey: "temporary-api-key" });
      return Response.json({ accessToken: "connect-token" });
    });
    vi.stubGlobal("fetch", fetcher);

    const { createPluggyConnectToken } = await import("@/features/open-finance/pluggy");
    await expect(createPluggyConnectToken(credentials, "user-123")).resolves.toEqual({ accessToken: "connect-token" });

    const [, request] = fetcher.mock.calls[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      options: { clientUserId: "user-123", avoidDuplicates: true },
    });
  });
});
