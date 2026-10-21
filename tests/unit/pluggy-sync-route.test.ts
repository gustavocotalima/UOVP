import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  all: vi.fn(), one: vi.fn(), user: vi.fn(), sameOrigin: vi.fn(),
  rateLimit: vi.fn(), revalidate: vi.fn(), log: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/current-user", () => ({ getActiveUser: mocks.user }));
vi.mock("@/lib/request-security", () => ({ isSameOriginRequest: mocks.sameOrigin }));
vi.mock("@/lib/integration-observability", () => ({
  anonymizedUserId: () => "anonymous-user", logIntegrationRefresh: mocks.log,
}));
vi.mock("@/lib/operation-security", () => ({
  assertUserOperationRateLimit: mocks.rateLimit,
  OperationInProgressError: class OperationInProgressError extends Error {},
  OperationRateLimitError: class OperationRateLimitError extends Error {
    readonly retryAfterSeconds = 60;
  },
}));
vi.mock("@/features/open-finance/sync", () => ({
  syncAllPluggyItemsForUser: mocks.all,
  syncPluggyItemForUser: mocks.one,
  // The route and the test receive this exact constructor, preserving instanceof
  // without importing provider code or opening a database connection.
  PluggySyncError: class PluggySyncError extends Error {
    readonly changed = true;
    constructor(cause: unknown) {
      super(cause instanceof Error ? cause.message : "Falha desconhecida.");
    }
  },
}));

import { POST } from "@/app/api/pluggy/sync/route";
import { PluggySyncError } from "@/features/open-finance/sync";

const itemId = "11111111-1111-4111-8111-111111111111";
const expectedPaths = ["/open-finance", "/home", "/orcamento-domestico", "/metas", "/contas", "/faturas", "/transacoes", "/tags", "/carteira"];

function request(input: { itemId?: string } = {}) {
  return POST(new Request("https://uovp.example/api/pluggy/sync", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://uovp.example" },
    body: JSON.stringify(input),
  }));
}

function allFailedResult(changed: boolean) {
  return {
    changed, itemCount: 2, pendingItemCount: 2, succeededItemCount: 0, failedItemCount: 2,
    partialItemCount: 0, partiallyUpdatedItemCount: changed ? 2 : 0,
    accountCount: 0, transactionCount: 0, investmentCount: 0,
    failures: ["first", "second"].map((id) => ({ itemId: id, message: "Falha de transporte.", changed })),
  };
}

describe("resposta HTTP da sincronização Pluggy com progresso parcial", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sameOrigin.mockReturnValue(true);
    mocks.user.mockResolvedValue({ id: "user-a" });
    mocks.rateLimit.mockResolvedValue(undefined);
  });

  it("retorna 502 e changed=false quando todas falham antes de atualizar dados", async () => {
    const result = allFailedResult(false);
    mocks.all.mockResolvedValue(result);
    const response = await request();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ...result,
      error: "Nenhuma conexão pôde ser sincronizada. Não houve atualização dos dados financeiros das conexões.",
    });
    expect(mocks.all).toHaveBeenCalledWith("user-a");
    expect(mocks.one).not.toHaveBeenCalled();
  });

  it("retorna 207, changed=true e invalida snapshots quando todas falham após commits", async () => {
    const result = allFailedResult(true);
    mocks.all.mockResolvedValue(result);
    const response = await request();
    expect(response.status).toBe(207);
    const body = await response.json();
    expect(body).toMatchObject({ ...result, changed: true, partiallyUpdatedItemCount: 2 });
    expect(body.warning).toContain("Parte dos dados já foi atualizada");
    expect(body.warning).toContain("uma nova sincronização continuará o processo");
    expect(body.error).toBeUndefined();
    expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual(expectedPaths);
  });

  it("retorna parcial e invalida snapshots quando um item lança PluggySyncError", async () => {
    mocks.one.mockRejectedValue(new PluggySyncError(new Error("Falha interna do provedor.")));
    const response = await request({ itemId });
    expect(response.status).toBe(207);
    const body = await response.json();
    expect(body).toMatchObject({ changed: true, partial: true });
    expect(body.warning).toContain("após atualizar parte dos dados");
    expect(JSON.stringify(body)).not.toContain("Falha interna do provedor");
    expect(mocks.one).toHaveBeenCalledWith("user-a", itemId);
    expect(mocks.all).not.toHaveBeenCalled();
    expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual(expectedPaths);
  });

  it("mantém 502 para falha de um item sem commits e não afirma preservação indevida", async () => {
    mocks.one.mockRejectedValue(new Error("Não foi possível consultar a conexão."));
    const response = await request({ itemId });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Não foi possível consultar a conexão." });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("recusa ausência de sessão antes de invocar sincronização ou rate limit", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await request()).status).toBe(401);
    expect(mocks.all).not.toHaveBeenCalled();
    expect(mocks.one).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });
});
