import { beforeEach, describe, expect, it, vi } from "vitest";

type UserRow = { id: string; sessionVersion: number; name: string; email: string; image: null; isAdmin: boolean };
type RenderContext = {
  cache: Map<() => Promise<unknown>, Promise<unknown>>;
  session: { user: { id: string; sessionVersion: number } } | null;
  row: UserRow | null;
};

const mocks = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return {
    render: new AsyncLocalStorage<RenderContext>(),
    auth: vi.fn(), user: vi.fn(), redirect: vi.fn(),
  };
});

// The framework normally supplies this scope during an RSC render. Use an
// AsyncLocalStorage harness to exercise our authorization contract, including
// overlapping requests, without relying on private React dispatcher internals.
vi.mock("react", () => ({
  cache: (read: () => Promise<unknown>) => () => {
    const cache = mocks.render.getStore()?.cache;
    if (!cache) return read();
    if (!cache.has(read)) cache.set(read, read());
    return cache.get(read)!;
  },
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: mocks.user } } }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { getActiveUser, requireUser, requireUserId } from "@/lib/current-user";

function row(id: string, version = 1, isAdmin = false): UserRow {
  return { id, sessionVersion: version, name: id, email: `${id}@example.com`, image: null, isAdmin };
}

function renderRequest<T>(user: UserRow | null, operation: () => T, sessionVersion = user?.sessionVersion) {
  return mocks.render.run({
    cache: new Map(), row: user,
    session: user ? { user: { id: user.id, sessionVersion: sessionVersion! } } : null,
  }, operation);
}

describe("usuário autenticado no escopo de cada render", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockImplementation(async () => {
      await Promise.resolve();
      return mocks.render.getStore()?.session ?? null;
    });
    mocks.user.mockImplementation(async ({ where }: { where: { id: string; sessionVersion: number } }) => {
      await Promise.resolve();
      const user = mocks.render.getStore()?.row;
      return user?.id === where.id && user.sessionVersion === where.sessionVersion ? user : null;
    });
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`Redirect: ${path}`); });
  });

  it("deduplica sessão e query entre layout, página e consumidores do mesmo render", async () => {
    const user = row("user-a", 3, true);
    const [active, required, id] = await renderRequest(user, () =>
      Promise.all([getActiveUser(), requireUser(), requireUserId()]));
    expect(active).toEqual(user);
    expect(required).toBe(active);
    expect(id).toBe(user.id);
    expect(mocks.auth).toHaveBeenCalledTimes(1);
    expect(mocks.user).toHaveBeenCalledExactlyOnceWith({
      where: { id: user.id, sessionVersion: 3 },
      select: { id: true, name: true, email: true, image: true, isAdmin: true },
    });
  });

  it("não compartilha usuários entre renders concorrentes", async () => {
    const first = row("first", 2, true);
    const second = row("second", 7, false);
    const [firstResult, secondResult] = await Promise.all([
      renderRequest(first, () => Promise.all([getActiveUser(), requireUserId()])),
      renderRequest(second, () => Promise.all([getActiveUser(), requireUserId()])),
    ]);
    expect(firstResult).toEqual([first, first.id]);
    expect(secondResult).toEqual([second, second.id]);
    expect(mocks.auth).toHaveBeenCalledTimes(2);
    expect(mocks.user).toHaveBeenCalledTimes(2);
  });

  it("relê privilégios e rejeita sessionVersion revogado no render seguinte", async () => {
    expect(await renderRequest(row("user-a", 1, true), getActiveUser)).toMatchObject({ isAdmin: true });
    expect(await renderRequest(row("user-a", 1, false), getActiveUser)).toMatchObject({ isAdmin: false });
    expect(await renderRequest(row("user-a", 2, false), getActiveUser, 1)).toBeNull();
    expect(await renderRequest(row("user-a", 2, false), getActiveUser, 2)).toMatchObject({ id: "user-a" });
    expect(mocks.auth).toHaveBeenCalledTimes(4);
    expect(mocks.user).toHaveBeenCalledTimes(4);
    expect(mocks.user.mock.calls[2][0].where).toEqual({ id: "user-a", sessionVersion: 1 });
  });

  it("preserva redirecionamento e evita consultar banco quando não existe sessão", async () => {
    await expect(renderRequest(null, requireUser)).rejects.toThrow("Redirect: /login");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.auth).toHaveBeenCalledTimes(1);
    expect(mocks.user).not.toHaveBeenCalled();
  });
});
