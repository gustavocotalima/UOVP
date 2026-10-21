import { createHash, randomUUID } from "node:crypto";
import { createClient } from "redis";

function createCacheClient(url: string) {
  return createClient({
    url,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1_000,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy: (retries) => retries >= 2 ? false : Math.min(100 * 2 ** retries, 500),
    },
  });
}

type RedisClient = ReturnType<typeof createCacheClient>;

type SharedCacheEnvelope = {
  cachedAt: number;
  value: unknown;
};

export type SharedCacheHit<T> = {
  cachedAt: number;
  ageMs: number;
  value: T;
};

export type MarketCacheMode = "USE_CACHE" | "REFRESH";

type RedisGlobal = {
  client: RedisClient | null;
  connection: Promise<RedisClient | null> | null;
  flights: Map<string, Promise<unknown>>;
  retryAt: number;
  url: string | null;
};

const globalForRedis = globalThis as unknown as {
  uovpRedis?: RedisGlobal;
};

const redisGlobal = globalForRedis.uovpRedis ?? {
  client: null,
  connection: null,
  flights: new Map(),
  retryAt: 0,
  url: null,
};

globalForRedis.uovpRedis = redisGlobal;

const RETRY_COOLDOWN_MS = 30_000;
const REDIS_DEADLINE_MS = 2_000;

function redisUrl() {
  return process.env.REDIS_URL?.trim() || null;
}

function cacheNamespace() {
  return process.env.SHARED_CACHE_NAMESPACE?.trim() || "uovp:shared:v1";
}

function namespacedKey(key: string) {
  return `${cacheNamespace()}:${key}`;
}

function parseEnvelope(raw: string | null): SharedCacheEnvelope | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed
      || typeof parsed !== "object"
      || !("cachedAt" in parsed)
      || !("value" in parsed)
      || typeof parsed.cachedAt !== "number"
      || !Number.isFinite(parsed.cachedAt)
    ) {
      return null;
    }
    return { cachedAt: parsed.cachedAt, value: parsed.value };
  } catch {
    return null;
  }
}

function destroyCacheClient(client: RedisClient) {
  try {
    client.destroy();
  } catch {
    // node-redis throws ClientClosedError when a disconnected client is destroyed again.
  }
}

function markCacheClientUnavailable(client: RedisClient) {
  if (redisGlobal.client !== client) return;
  redisGlobal.client = null;
  redisGlobal.retryAt = Date.now() + RETRY_COOLDOWN_MS;
  destroyCacheClient(client);
}

async function cacheCommand<T>(client: RedisClient, operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Closing the transport also clears queued/in-flight commands. A
          // timeout must not leave work accumulating behind an optional cache.
          markCacheClientUnavailable(client);
          reject(new Error("Shared cache deadline exceeded."));
        }, REDIS_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function redisClient(): Promise<RedisClient | null> {
  const url = redisUrl();
  if (!url) return null;
  if (redisGlobal.client?.isReady && redisGlobal.url === url) return redisGlobal.client;
  if (redisGlobal.connection && redisGlobal.url === url) return redisGlobal.connection;
  if (Date.now() < redisGlobal.retryAt) return null;

  if (redisGlobal.client && (redisGlobal.url !== url || !redisGlobal.client.isReady)) {
    const staleClient = redisGlobal.client;
    redisGlobal.client = null;
    destroyCacheClient(staleClient);
  }

  redisGlobal.url = url;
  let client: RedisClient;
  try {
    client = createCacheClient(url);
  } catch {
    redisGlobal.retryAt = Date.now() + RETRY_COOLDOWN_MS;
    return null;
  }
  client.on("error", () => {
    // Cache failures are intentionally non-fatal. Provider requests remain the source of truth.
  });
  client.on("end", () => {
    if (redisGlobal.client === client) {
      redisGlobal.client = null;
      redisGlobal.retryAt = Date.now() + RETRY_COOLDOWN_MS;
    }
  });
  redisGlobal.client = client;
  const connection = cacheCommand(client, () => client.connect())
    .then(() => client)
    .catch(() => {
      destroyCacheClient(client);
      if (redisGlobal.client === client) redisGlobal.client = null;
      redisGlobal.retryAt = Date.now() + RETRY_COOLDOWN_MS;
      return null;
    })
    .finally(() => {
      if (redisGlobal.connection === connection) redisGlobal.connection = null;
    });
  redisGlobal.connection = connection;
  return connection;
}

export function isSharedCacheConfigured() {
  return Boolean(redisUrl());
}

export function sharedCacheKey(scope: string, ...parts: unknown[]) {
  const digest = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("base64url")
    .slice(0, 32);
  return `${scope}:${digest}`;
}

export async function getSharedCache<T>(
  key: string,
  decode: (value: unknown) => T | null,
): Promise<SharedCacheHit<T> | null> {
  const client = await redisClient();
  if (!client) return null;
  try {
    const envelope = parseEnvelope(await cacheCommand(client, () => client.get(namespacedKey(key))));
    if (!envelope) return null;
    const value = decode(envelope.value);
    if (value == null) return null;
    return {
      cachedAt: envelope.cachedAt,
      ageMs: Math.max(0, Date.now() - envelope.cachedAt),
      value,
    };
  } catch {
    markCacheClientUnavailable(client);
    return null;
  }
}

export async function getSharedCacheMany<T>(
  keys: string[],
  decode: (value: unknown) => T | null,
): Promise<Map<string, SharedCacheHit<T>>> {
  const uniqueKeys = [...new Set(keys)];
  if (!uniqueKeys.length) return new Map();
  const client = await redisClient();
  if (!client) return new Map();
  try {
    const values = await cacheCommand(client, () => client.mGet(uniqueKeys.map(namespacedKey)));
    return new Map(uniqueKeys.flatMap((key, index) => {
      const envelope = parseEnvelope(values[index] ?? null);
      if (!envelope) return [];
      const value = decode(envelope.value);
      if (value == null) return [];
      return [[key, {
        cachedAt: envelope.cachedAt,
        ageMs: Math.max(0, Date.now() - envelope.cachedAt),
        value,
      }] as const];
    }));
  } catch {
    markCacheClientUnavailable(client);
    return new Map();
  }
}

export async function setSharedCache(
  key: string,
  value: unknown,
  ttlSeconds?: number,
  cachedAt = Date.now(),
) {
  const client = await redisClient();
  if (!client) return;
  try {
    const serialized = JSON.stringify({ cachedAt, value } satisfies SharedCacheEnvelope);
    if (ttlSeconds == null) await cacheCommand(client, () => client.set(namespacedKey(key), serialized));
    else {
      await cacheCommand(client, () => client.set(
        namespacedKey(key),
        serialized,
        { EX: Math.max(1, Math.ceil(ttlSeconds)) },
      ));
    }
  } catch {
    markCacheClientUnavailable(client);
    // A cache write must never fail the provider operation that produced the value.
  }
}

export async function setSharedCacheMany(
  entries: Array<{ key: string; value: unknown; ttlSeconds?: number; cachedAt?: number }>,
) {
  if (!entries.length) return;
  const client = await redisClient();
  if (!client) return;
  try {
    const multi = client.multi();
    for (const entry of entries) {
      const serialized = JSON.stringify({
        cachedAt: entry.cachedAt ?? Date.now(),
        value: entry.value,
      } satisfies SharedCacheEnvelope);
      if (entry.ttlSeconds == null) multi.set(namespacedKey(entry.key), serialized);
      else {
        multi.set(
          namespacedKey(entry.key),
          serialized,
          { EX: Math.max(1, Math.ceil(entry.ttlSeconds)) },
        );
      }
    }
    await cacheCommand(client, () => multi.exec());
  } catch {
    markCacheClientUnavailable(client);
    // A cache write must never fail the provider operation that produced the value.
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function releaseLock(client: RedisClient, key: string, token: string) {
  try {
    await cacheCommand(client, () => client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      { keys: [key], arguments: [token] },
    ));
  } catch {
    markCacheClientUnavailable(client);
    // The lock expires automatically and cache availability must remain non-fatal.
  }
}

export class SharedCacheBusyError extends Error {
  constructor() {
    super("Uma consulta compartilhada ainda está em andamento. Tente novamente.");
    this.name = "SharedCacheBusyError";
  }
}

async function withRenewingCacheLock<T>(client: RedisClient, key: string, token: string, lockMs: number, operation: () => Promise<T>) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renewal: Promise<void> | undefined;
  const schedule = () => {
    timer = setTimeout(() => {
      if (!active) return;
      renewal = cacheCommand(client, () => client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        { keys: [key], arguments: [token, String(lockMs)] },
      )).then((owned) => {
        if (!owned) active = false;
      }).catch(() => {
        active = false;
        markCacheClientUnavailable(client);
      }).finally(() => {
        if (active) schedule();
      });
    }, Math.max(10, Math.floor(lockMs / 3)));
  };
  schedule();
  try {
    return await operation();
  } finally {
    active = false;
    if (timer) clearTimeout(timer);
    await renewal;
    await releaseLock(client, key, token);
  }
}

export async function withSharedCacheCoalescing<T>({
  key,
  operation,
  readAfterWait,
  lockMs = 15_000,
  waitTimeoutMs = 60_000,
}: {
  key: string;
  operation: () => Promise<T>;
  readAfterWait?: (lockStartedAt: number) => Promise<T | null>;
  lockMs?: number;
  waitTimeoutMs?: number;
}): Promise<T> {
  if (!Number.isFinite(lockMs) || lockMs < 30 || !Number.isFinite(waitTimeoutMs) || waitTimeoutMs <= 0) {
    throw new RangeError("Os prazos de coalescência precisam ser positivos e finitos.");
  }
  const flightKey = namespacedKey(`flight:${key}`);
  const existing = redisGlobal.flights.get(flightKey) as Promise<T> | undefined;
  if (existing) return existing;

  const flight = (async () => {
    const flightStartedAt = Date.now();
    const client = await redisClient();
    if (!client) return operation();

    const lockKey = namespacedKey(`lock:${key}`);
    const waitDeadline = Date.now() + waitTimeoutMs;
    let observedStartedAt: number | undefined;
    while (true) {
      // Read before attempting to take over an expired/released lock: a leader
      // may have published its result immediately before releasing ownership.
      if (observedStartedAt !== undefined && readAfterWait) {
        const value = await readAfterWait(observedStartedAt);
        if (value != null) return value;
      }
      const lockStartedAt = Date.now();
      const token = `${lockStartedAt}:${randomUUID()}`;
      let acquired: boolean;
      let currentToken: string | null = null;
      try {
        acquired = Boolean(await cacheCommand(client, () => client.set(lockKey, token, { NX: true, PX: lockMs })));
        if (!acquired) currentToken = await cacheCommand(client, () => client.get(lockKey));
      } catch {
        markCacheClientUnavailable(client);
        return operation();
      }
      if (acquired) {
        // Recheck after NX as another process can publish between the read and
        // acquisition. Provider errors stay outside the infrastructure catch.
        return withRenewingCacheLock(client, lockKey, token, lockMs, async () => {
          if (readAfterWait) {
            const value = await readAfterWait(observedStartedAt ?? flightStartedAt);
            if (value != null) return value;
          }
          return operation();
        });
      }
      const separator = currentToken?.indexOf(":") ?? -1;
      const parsed = separator > 0 ? Number(currentToken?.slice(0, separator)) : 0;
      if (Number.isFinite(parsed) && parsed > 0) observedStartedAt = parsed;
      if (Date.now() >= waitDeadline) throw new SharedCacheBusyError();
      await wait(Math.min(100, Math.max(1, waitDeadline - Date.now())));
    }
  })();

  redisGlobal.flights.set(flightKey, flight);
  try {
    return await flight;
  } finally {
    if (redisGlobal.flights.get(flightKey) === flight) redisGlobal.flights.delete(flightKey);
  }
}

export function resetSharedCacheForTests() {
  if (redisGlobal.client) destroyCacheClient(redisGlobal.client);
  redisGlobal.client = null;
  redisGlobal.connection = null;
  redisGlobal.flights.clear();
  redisGlobal.retryAt = 0;
  redisGlobal.url = null;
}
