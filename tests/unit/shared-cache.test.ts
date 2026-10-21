import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => {
  const values = new Map<string, string>();
  const expirations = new Map<string, number>();
  const read = (key: string) => {
    const expiresAt = expirations.get(key);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      values.delete(key);
      expirations.delete(key);
    }
    return values.get(key) ?? null;
  };
  let ready = false;
  let failConnection = false;
  let throwWhenDestroyingClosed = false;

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
      if (!ready && throwWhenDestroyingClosed) throw new Error("The client is closed");
      ready = false;
    }),
    get: vi.fn(async (key: string) => read(key)),
    mGet: vi.fn(async (keys: string[]) => keys.map(read)),
    set: vi.fn(async (key: string, value: string, options?: { NX?: boolean; PX?: number; EX?: number }) => {
      if (options?.NX && read(key) !== null) return null;
      values.set(key, value);
      const ttl = options?.PX ?? (options?.EX == null ? undefined : options.EX * 1_000);
      if (ttl == null) expirations.delete(key);
      else expirations.set(key, Date.now() + ttl);
      return "OK";
    }),
    multi: vi.fn(() => multi),
    eval: vi.fn(async (script: string, options: { keys: string[]; arguments: string[] }) => {
      const [key] = options.keys;
      if (read(key) !== options.arguments[0]) return 0;
      if (script.includes("pexpire")) {
        expirations.set(key, Date.now() + Number(options.arguments[1]));
        return 1;
      }
      values.delete(key);
      expirations.delete(key);
      return 1;
    }),
  };
  return {
    client,
    createClient: vi.fn(() => client),
    values,
    reset() {
      values.clear();
      expirations.clear();
      multi.operations = [];
      ready = false;
      failConnection = false;
      throwWhenDestroyingClosed = false;
      vi.clearAllMocks();
    },
    failConnection() {
      failConnection = true;
    },
    closeUnexpectedly() {
      ready = false;
      throwWhenDestroyingClosed = true;
      failConnection = true;
    },
  };
});

vi.mock("redis", () => ({ createClient: redisMock.createClient }));

function neverResolves(): Promise<never> {
  return new Promise<never>(() => undefined);
}

import {
  getSharedCache,
  getSharedCacheMany,
  resetSharedCacheForTests,
  setSharedCache,
  setSharedCacheMany,
  sharedCacheKey,
  SharedCacheBusyError,
  withSharedCacheCoalescing,
} from "@/lib/shared-cache";

beforeEach(() => {
  resetSharedCacheForTests();
  redisMock.reset();
  process.env.REDIS_URL = "redis://default:test@redis:6379";
  process.env.SHARED_CACHE_NAMESPACE = "uovp:test:v1";
});

afterEach(() => {
  resetSharedCacheForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("cache público compartilhado", () => {
  it("relê publicação feita entre o miss externo e a primeira aquisição do lock", async () => {
    const operation = vi.fn(async () => "duplicada");
    const readAfterWait = vi.fn(async () => "já publicado");
    await expect(withSharedCacheCoalescing({ key: "initial-race", operation, readAfterWait })).resolves.toBe("já publicado");
    expect(readAfterWait).toHaveBeenCalledOnce();
    expect(operation).not.toHaveBeenCalled();
    expect(redisMock.values.has("uovp:test:v1:lock:initial-race")).toBe(false);
  });
  it("aguarda resultado do outro processo além de quatro segundos sem duplicar chamada", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const lockKey = "uovp:test:v1:lock:slow-provider";
    redisMock.values.set(lockKey, `${startedAt}:other-process`);
    let published: string | null = null;
    setTimeout(() => { published = "publicado pelo líder"; redisMock.values.delete(lockKey); }, 6_000);
    const operation = vi.fn(async () => "duplicada");
    const readAfterWait = vi.fn(async (minimumAt: number) => minimumAt === startedAt ? published : null);
    const settled = expect(withSharedCacheCoalescing({ key: "slow-provider", operation, readAfterWait })).resolves.toBe("publicado pelo líder");
    await vi.advanceTimersByTimeAsync(4_500);
    expect(operation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    await settled;
    expect(operation).not.toHaveBeenCalled();
    expect(readAfterWait).toHaveBeenCalledWith(startedAt);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([6_000, 15_000])("adquire NX depois de falha ou expiração do líder em %sms", async (releasedAt) => {
    vi.useFakeTimers();
    const lockKey = "uovp:test:v1:lock:failed-provider";
    redisMock.values.set(lockKey, `${Date.now()}:other-process`);
    setTimeout(() => redisMock.values.delete(lockKey), releasedAt);
    const operation = vi.fn(async () => {
      expect(redisMock.values.get(lockKey)).not.toContain("other-process");
      return "recuperado";
    });
    const settled = expect(withSharedCacheCoalescing({ key: "failed-provider", operation, readAfterWait: async () => null })).resolves.toBe("recuperado");
    await vi.advanceTimersByTimeAsync(releasedAt - 100);
    expect(operation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await settled;
    expect(operation).toHaveBeenCalledOnce();
    expect(redisMock.values.has(lockKey)).toBe(false);
  });

  it("renova propriedade durante consulta longa e libera apenas seu próprio token", async () => {
    vi.useFakeTimers();
    const lockKey = "uovp:test:v1:lock:renewed-provider";
    const settled = expect(withSharedCacheCoalescing({
      key: "renewed-provider",
      operation: () => new Promise<string>((resolve) => setTimeout(() => resolve("resultado"), 40_000)),
    })).resolves.toBe("resultado");
    await vi.advanceTimersByTimeAsync(20_000);
    // The fake honors PX/PEXPIRE on reads: a lock without renewal is expired.
    expect(await redisMock.client.get(lockKey)).not.toBeNull();
    expect(redisMock.client.eval.mock.calls.filter(([script]) => script.includes("pexpire")).length).toBeGreaterThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(20_000);
    await settled;
    expect(redisMock.values.has(lockKey)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("não executa uma consulta duplicada ao esgotar a espera com lock ainda válido", async () => {
    vi.useFakeTimers();
    const lockKey = "uovp:test:v1:lock:still-owned";
    redisMock.values.set(lockKey, `${Date.now()}:other-process`);
    const operation = vi.fn(async () => "duplicada");
    const settled = expect(withSharedCacheCoalescing({ key: "still-owned", operation, lockMs: 300, waitTimeoutMs: 800, readAfterWait: async () => null })).rejects.toBeInstanceOf(SharedCacheBusyError);
    await vi.advanceTimersByTimeAsync(800);
    await settled;
    expect(operation).not.toHaveBeenCalled();
    expect(redisMock.values.get(lockKey)).toContain("other-process");
    redisMock.values.delete(lockKey);
    await expect(withSharedCacheCoalescing({ key: "still-owned", operation })).resolves.toBe("duplicada");
    expect(operation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserva a falha do provedor sem executar novamente, mesmo se liberar lock falhar", async () => {
    redisMock.client.eval.mockRejectedValueOnce(new Error("cache offline"));
    const cause = new Error("provider unavailable");
    const operation = vi.fn(async () => { throw cause; });
    await expect(withSharedCacheCoalescing({ key: "provider-error", operation })).rejects.toBe(cause);
    expect(operation).toHaveBeenCalledOnce();
  });

  it("limita a fila e rejeita comandos durante reconexão", async () => {
    await setSharedCache("configuration", 1);
    expect(redisMock.createClient).toHaveBeenCalledWith(expect.objectContaining({
      disableOfflineQueue: true,
      commandsQueueMaxLength: 1_000,
    }));
  });

  it("abandona conexão pendurada e consulta o provedor uma única vez", async () => {
    vi.useFakeTimers();
    redisMock.client.connect.mockImplementationOnce(neverResolves);
    const operation = vi.fn(async () => "direto");
    const result = expect(withSharedCacheCoalescing({ key: "connect-hang", operation })).resolves.toBe("direto");
    await vi.advanceTimersByTimeAsync(2_000);
    await result;
    expect(redisMock.client.destroy).toHaveBeenCalled();
    expect(operation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["get", "mGet"] as const)("limita %s pendurado e usa cooldown", async (method) => {
    await setSharedCache("warm", 1);
    vi.useFakeTimers();
    const hung = redisMock.client[method].mockImplementationOnce(neverResolves);
    const request = method === "get" ? getSharedCache("warm", () => 1) : getSharedCacheMany(["warm"], () => 1);
    const settled = method === "get" ? expect(request).resolves.toBeNull() : expect(request).resolves.toEqual(new Map());
    await vi.advanceTimersByTimeAsync(2_000);
    await settled;
    expect(redisMock.client.destroy).toHaveBeenCalled();
    await expect(getSharedCache("warm", () => 1)).resolves.toBeNull();
    expect(hung).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["set", "pipeline"] as const)("limita escrita %s sem impedir o resultado financeiro", async (method) => {
    await setSharedCache("warm", 1);
    vi.useFakeTimers();
    if (method === "set") redisMock.client.set.mockImplementationOnce(neverResolves);
    else vi.spyOn(redisMock.client.multi(), "exec").mockImplementationOnce(neverResolves);
    const request = method === "set" ? setSharedCache("price", 10, 60) : setSharedCacheMany([{ key: "price", value: 10 }]);
    const settled = expect(request).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(2_000);
    await settled;
    expect(redisMock.client.destroy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limita aquisição pendurada do lock e segue sem cache", async () => {
    await setSharedCache("warm", 1);
    vi.useFakeTimers();
    redisMock.client.set.mockImplementationOnce(neverResolves);
    const operation = vi.fn(async () => "cotação");
    const settled = expect(withSharedCacheCoalescing({ key: "lock-hang", operation })).resolves.toBe("cotação");
    await vi.advanceTimersByTimeAsync(2_000);
    await settled;
    expect(operation).toHaveBeenCalledOnce();
    expect(redisMock.client.destroy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limita liberação pendurada do lock e preserva resultado do provedor", async () => {
    await setSharedCache("warm", 1);
    vi.useFakeTimers();
    redisMock.client.eval.mockImplementationOnce(neverResolves);
    const settled = expect(withSharedCacheCoalescing({ key: "release-hang", operation: async () => "cotação" })).resolves.toBe("cotação");
    await vi.advanceTimersByTimeAsync(2_000);
    await settled;
    expect(redisMock.client.destroy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

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

  it("continua sem cache quando o cliente Redis já foi fechado", async () => {
    await setSharedCache(sharedCacheKey("brapi:quote", "WEGE3"), { price: 42 });
    redisMock.closeUnexpectedly();
    const providerOperation = vi.fn(async () => "cotação direta");

    await expect(withSharedCacheCoalescing({
      key: "quote:WEGE3",
      operation: providerOperation,
    })).resolves.toBe("cotação direta");
    expect(providerOperation).toHaveBeenCalledOnce();
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
