import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ search: vi.fn(), quote: vi.fn(), quoteSummary: vi.fn() }));
const redisMock = vi.hoisted(() => {
  const values = new Map<string, string>();
  const expirations = new Map<string, number>();
  let ready = false;
  const read = (key: string) => {
    if ((expirations.get(key) ?? Infinity) <= Date.now()) {
      values.delete(key);
      expirations.delete(key);
    }
    return values.get(key) ?? null;
  };
  const client = {
    get isReady() { return ready; },
    on: vi.fn(),
    connect: vi.fn(async () => { ready = true; }),
    destroy: vi.fn(() => { ready = false; }),
    get: vi.fn(async (key: string) => read(key)),
    mGet: vi.fn(async (keys: string[]) => keys.map(read)),
    set: vi.fn(async (key: string, value: string, options?: { NX?: boolean; PX?: number; EX?: number }) => {
      if (options?.NX && read(key) !== null) return null;
      values.set(key, value);
      const ttl = options?.PX ?? (options?.EX === undefined ? undefined : options.EX * 1_000);
      if (ttl === undefined) expirations.delete(key);
      else expirations.set(key, Date.now() + ttl);
      return "OK";
    }),
    multi: vi.fn(() => {
      const entries: Array<[string, string]> = [];
      const multi = {
        set(key: string, value: string) { entries.push([key, value]); return multi; },
        async exec() { for (const [key, value] of entries) values.set(key, value); return []; },
      };
      return multi;
    }),
    eval: vi.fn(async (script: string, options: { keys: string[]; arguments: string[] }) => {
      const key = options.keys[0];
      if (read(key) !== options.arguments[0]) return 0;
      if (script.includes("pexpire")) expirations.set(key, Date.now() + Number(options.arguments[1]));
      else { values.delete(key); expirations.delete(key); }
      return 1;
    }),
  };
  return { values, expirations, client };
});
vi.mock("redis", () => ({ createClient: () => redisMock.client }));
vi.mock("yahoo-finance2", () => ({
  default: class { search = sdk.search; quote = sdk.quote; quoteSummary = sdk.quoteSummary; },
}));
vi.mock("@/lib/shared-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shared-cache")>();
  return { ...actual, withSharedCacheCoalescing: vi.fn(actual.withSharedCacheCoalescing) };
});

import { resetSharedCacheForTests, sharedCacheKey, withSharedCacheCoalescing } from "@/lib/shared-cache";
import { fetchYahooAssetProfile, fetchYahooQuotes, searchYahooTickers } from "@/features/portfolio/yahoo-finance";

const namespace = "uovp:yahoo-caller-abort";
const cases = [
  {
    name: "busca",
    method: sdk.search,
    payload: { quotes: [] },
    key: () => sharedCacheKey("yahoo:search-flight", "AAPL", "INTERNATIONAL_STOCKS"),
    call: (signal: AbortSignal, useCache = false): Promise<unknown> => searchYahooTickers({ query: "AAPL", kind: "INTERNATIONAL_STOCKS", signal, cacheMode: useCache ? "USE_CACHE" : "REFRESH" }),
  },
  {
    name: "perfil",
    method: sdk.quoteSummary,
    payload: { assetProfile: { sector: "Technology", industry: "Software" } },
    key: () => sharedCacheKey("yahoo:profile-flight", "AAPL"),
    call: (signal: AbortSignal, useCache = false): Promise<unknown> => fetchYahooAssetProfile({ symbol: "AAPL", signal, cacheMode: useCache ? "USE_CACHE" : "REFRESH" }),
  },
  {
    name: "cotações",
    method: sdk.quote,
    payload: { AAPL: { symbol: "AAPL", regularMarketPrice: 100, currency: "USD" } },
    key: () => sharedCacheKey("yahoo:quote-flight", ["AAPL"]),
    call: (signal: AbortSignal, useCache = false): Promise<unknown> => fetchYahooQuotes({ symbols: ["AAPL"], signal, cacheMode: useCache ? "USE_CACHE" : "REFRESH" }),
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  resetSharedCacheForTests();
  redisMock.values.clear();
  redisMock.expirations.clear();
  vi.clearAllMocks();
  sdk.search.mockReset().mockResolvedValue({ quotes: [] });
  sdk.quote.mockReset().mockResolvedValue({ AAPL: { symbol: "AAPL", regularMarketPrice: 100, currency: "USD" } });
  sdk.quoteSummary.mockReset().mockResolvedValue({ assetProfile: { sector: "Technology" } });
  vi.stubEnv("REDIS_URL", "redis://isolated-mock:6379");
  vi.stubEnv("SHARED_CACHE_NAMESPACE", namespace);
  vi.useFakeTimers();
});

afterEach(() => {
  resetSharedCacheForTests();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe.each(cases)("cancelamento local Yahoo com cache compartilhado: $name", (testCase) => {
  it("cancela o seguidor imediatamente e mantém o líder consultando e publicando", async () => {
    const pending = deferred<unknown>();
    testCase.method.mockReturnValueOnce(pending.promise);
    const leaderController = new AbortController();
    const leader = testCase.call(leaderController.signal);
    let leaderSettled = false;
    void leader.then(() => { leaderSettled = true; });
    await vi.waitFor(() => expect(testCase.method).toHaveBeenCalledOnce());
    const leaderSignal: AbortSignal = testCase.method.mock.calls[0][2].fetchOptions.signal;
    const followerController = new AbortController();
    const follower = testCase.call(followerController.signal);
    const reason = new Error("Cancelamento do seguidor");
    const rejected = expect(follower).rejects.toBe(reason);
    await vi.waitFor(() => expect(withSharedCacheCoalescing).toHaveBeenCalledTimes(2));

    followerController.abort(reason);
    await rejected;

    expect(leaderSettled).toBe(false);
    expect(leaderSignal.aborted).toBe(false);
    expect(testCase.method).toHaveBeenCalledOnce();
    pending.resolve(testCase.payload);
    await leader;
    expect([...redisMock.values.keys()].filter((key) => !key.includes(":lock:"))).toHaveLength(1);
    expect(leaderSignal.aborted).toBe(false);
    expect(testCase.method).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sinal já abortado impede leitura de cache, coalescing e chamada ao SDK", async () => {
    const controller = new AbortController();
    const reason = new Error("Cancelamento anterior à chamada");
    controller.abort(reason);

    await expect(testCase.call(controller.signal, true)).rejects.toBe(reason);

    expect(redisMock.client.connect).not.toHaveBeenCalled();
    expect(redisMock.client.get).not.toHaveBeenCalled();
    expect(redisMock.client.mGet).not.toHaveBeenCalled();
    expect(withSharedCacheCoalescing).not.toHaveBeenCalled();
    expect(testCase.method).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("interrompe a própria espera Redis sem novas leituras ou takeover após abort", async () => {
    const lockKey = `${namespace}:lock:${testCase.key()}`;
    const remoteToken = `${Date.now()}:remote-owner`;
    redisMock.values.set(lockKey, remoteToken);
    redisMock.expirations.set(lockKey, Date.now() + 60_000);
    const controller = new AbortController();
    const reason = new Error("Espera Redis cancelada");
    const pending = testCase.call(controller.signal);
    const rejected = expect(pending).rejects.toBe(reason);
    await vi.waitFor(() => expect(redisMock.client.get).toHaveBeenCalledWith(lockKey));
    const calls = { get: redisMock.client.get.mock.calls.length, mGet: redisMock.client.mGet.mock.calls.length, set: redisMock.client.set.mock.calls.length };

    controller.abort(reason);
    await rejected;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(redisMock.client.get).toHaveBeenCalledTimes(calls.get);
    expect(redisMock.client.mGet).toHaveBeenCalledTimes(calls.mGet);
    expect(redisMock.client.set).toHaveBeenCalledTimes(calls.set);
    expect(redisMock.values.get(lockKey)).toBe(remoteToken);
    expect(testCase.method).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancela imediatamente uma leitura inicial de cache ainda pendente", async () => {
    const controller = new AbortController();
    const reason = new Error("Leitura de cache cancelada");
    const singleRead = deferred<string | null>();
    const manyRead = deferred<Array<string | null>>();
    if (testCase.name === "cotações") redisMock.client.mGet.mockReturnValueOnce(manyRead.promise);
    else redisMock.client.get.mockReturnValueOnce(singleRead.promise);
    const pending = testCase.call(controller.signal, true);
    const rejected = expect(pending).rejects.toBe(reason);
    await vi.waitFor(() => expect(redisMock.client.get.mock.calls.length + redisMock.client.mGet.mock.calls.length).toBe(1));

    controller.abort(reason);
    await rejected;
    singleRead.resolve(null);
    manyRead.resolve([null]);
    await vi.advanceTimersByTimeAsync(0);

    expect(withSharedCacheCoalescing).not.toHaveBeenCalled();
    expect(testCase.method).not.toHaveBeenCalled();
    expect(redisMock.client.set).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resultado tardio de um SDK cancelado não é publicado no cache", async () => {
    const pendingSdk = deferred<unknown>();
    testCase.method.mockReturnValueOnce(pendingSdk.promise);
    const controller = new AbortController();
    const reason = new Error("Consulta cancelada antes da publicação");
    const pending = testCase.call(controller.signal);
    const rejected = expect(pending).rejects.toBe(reason);
    await vi.waitFor(() => expect(testCase.method).toHaveBeenCalledOnce());
    const sdkSignal: AbortSignal = testCase.method.mock.calls[0][2].fetchOptions.signal;

    controller.abort(reason);
    await rejected;
    pendingSdk.resolve(testCase.payload);
    await vi.advanceTimersByTimeAsync(0);

    expect(sdkSignal.aborted).toBe(true);
    expect(redisMock.values.size).toBe(0);
    expect(redisMock.client.multi).not.toHaveBeenCalled();
    expect(testCase.method).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
