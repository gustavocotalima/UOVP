import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => {
  const values = new Map<string, string>();
  let ready = false;
  let failConnection = false;

  const multi = {
    operations: [] as Array<[string, string]>,
    set(key: string, value: string) {
      this.operations.push([key, value]);
      return this;
    },
    async exec() {
      for (const [key, value] of this.operations) values.set(key, value);
      this.operations = [];
      return [];
    },
  };
  const client = {
    get isReady() {
      return ready;
    },
    on: vi.fn(() => client),
    connect: vi.fn(async () => {
      if (failConnection) throw new Error("offline");
      ready = true;
      return client;
    }),
    destroy: vi.fn(() => {
      ready = false;
    }),
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    mGet: vi.fn(async (keys: string[]) => keys.map((key) => values.get(key) ?? null)),
    set: vi.fn(async (key: string, value: string, options?: { NX?: boolean }) => {
      if (options?.NX && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    }),
    multi: vi.fn(() => multi),
    eval: vi.fn(async (_script: string, options: { keys: string[]; arguments: string[] }) => {
      const [key] = options.keys;
      if (values.get(key) !== options.arguments[0]) return 0;
      values.delete(key);
      return 1;
    }),
  };
  return {
    client,
    createClient: vi.fn(() => client),
    values,
    reset() {
      values.clear();
      multi.operations = [];
      ready = false;
      failConnection = false;
      vi.clearAllMocks();
    },
    failConnection() {
      failConnection = true;
    },
  };
});

vi.mock("redis", () => ({ createClient: redisMock.createClient }));

import {
  getSharedCache,
  getSharedCacheMany,
  resetSharedCacheForTests,
  setSharedCache,
  setSharedCacheMany,
  sharedCacheKey,
  withSharedCacheCoalescing,
} from "@/lib/shared-cache";

beforeEach(() => {
  resetSharedCacheForTests();
  redisMock.reset();
  process.env.REDIS_URL = "redis://default:test@redis:6379";
  process.env.SHARED_CACHE_NAMESPACE = "uovp:test:v1";
});

describe("cache público compartilhado", () => {
  it("usa namespace e chaves opacas sem credenciais ou usuário", () => {
    const key = sharedCacheKey("brapi:quote", "WEGE3", "gustavo", "token-secreto");

    expect(key).toMatch(/^brapi:quote:[A-Za-z0-9_-]{32}$/);
    expect(key).not.toContain("gustavo");
    expect(key).not.toContain("token-secreto");
  });

  it("grava e recupera valores validados", async () => {
    const key = sharedCacheKey("binance:quote", "BTCBRL");
    await setSharedCache(key, { price: "350000" });

    const hit = await getSharedCache(key, (value) => {
      if (!value || typeof value !== "object" || !("price" in value)) return null;
      return typeof value.price === "string" ? value : null;
    });

    expect(hit?.value).toEqual({ price: "350000" });
    expect([...redisMock.values.keys()][0]).toBe(`uovp:test:v1:${key}`);
  });

  it("usa MGET e pipeline para múltiplas cotações", async () => {
    const keys = ["WEGE3", "ITUB3"].map((symbol) => sharedCacheKey("brapi:quote", symbol));
    await setSharedCacheMany(keys.map((key, index) => ({
      key,
      value: { price: index + 10 },
    })));

    const hits = await getSharedCacheMany(keys, (value) => {
      if (!value || typeof value !== "object" || !("price" in value)) return null;
      return typeof value.price === "number" ? value : null;
    });

    expect([...hits.values()].map((hit) => hit.value.price)).toEqual([10, 11]);
    expect(redisMock.client.mGet).toHaveBeenCalledTimes(1);
    expect(redisMock.client.multi).toHaveBeenCalledTimes(1);
  });

  it("ignora conteúdo inválido e indisponibilidade do Redis", async () => {
    const key = sharedCacheKey("yahoo:quote", "GOOG");
    redisMock.values.set(`uovp:test:v1:${key}`, "{invalid");
    await expect(getSharedCache(key, () => ({ ok: true }))).resolves.toBeNull();

    resetSharedCacheForTests();
    redisMock.failConnection();
    await expect(setSharedCache(key, { price: 1 })).resolves.toBeUndefined();
    await expect(getSharedCache(key, () => ({ ok: true }))).resolves.toBeNull();
  });

  it("coalesce operações concorrentes no mesmo processo", async () => {
    const operation = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "resultado";
    });

    const results = await Promise.all([
      withSharedCacheCoalescing({ key: "quote:WEGE3", operation }),
      withSharedCacheCoalescing({ key: "quote:WEGE3", operation }),
    ]);

    expect(results).toEqual(["resultado", "resultado"]);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
