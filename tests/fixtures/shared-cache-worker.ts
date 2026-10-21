import { createClient } from "redis";
import {
  getSharedCache,
  resetSharedCacheForTests,
  setSharedCache,
  withSharedCacheCoalescing,
} from "../../lib/shared-cache";

export type SharedCacheWorkerRequest = {
  type: "run";
  requestId: string;
  key: string;
  value: string;
  delayMs: number;
  behavior?: "success" | "fail" | "hang";
  publishAtLockStart?: boolean;
  waitForRelease?: boolean;
};

function isRequest(message: unknown): message is SharedCacheWorkerRequest {
  return Boolean(message && typeof message === "object"
    && "type" in message && message.type === "run"
    && "requestId" in message && typeof message.requestId === "string"
    && "key" in message && typeof message.key === "string"
    && "value" in message && typeof message.value === "string"
    && "delayMs" in message && typeof message.delayMs === "number");
}

function send(message: Record<string, unknown>) {
  process.send?.(message);
}

async function main() {
  const url = process.env.UOVP_TEST_REDIS_URL;
  const namespace = process.env.SHARED_CACHE_NAMESPACE;
  if (!url || process.env.REDIS_URL !== url || !namespace?.startsWith("uovp:redis-integration:")) {
    throw new Error("The Redis fixture requires a dedicated test URL and namespace.");
  }
  const client = createClient({ url, socket: { connectTimeout: 2_000, reconnectStrategy: false } });
  client.on("error", () => undefined);
  await client.connect();
  const releases = new Map<string, () => void>();
  process.on("message", async (message: unknown) => {
    if (message && typeof message === "object" && "type" in message && message.type === "stop") {
      resetSharedCacheForTests();
      client.destroy();
      process.disconnect?.();
      return;
    }
    if (message && typeof message === "object" && "type" in message && message.type === "release"
      && "requestId" in message && typeof message.requestId === "string") {
      releases.get(message.requestId)?.();
      releases.delete(message.requestId);
      return;
    }
    if (!isRequest(message)) return;
    const request = message;
    const release = request.waitForRelease
      ? new Promise<void>((resolve) => { releases.set(request.requestId, resolve); })
      : null;
    const requestStartedAt = Date.now();
    const cacheKey = `result:${request.key}`;
    send({ type: "request-started", requestId: request.requestId, at: requestStartedAt });
    try {
      const result = await withSharedCacheCoalescing({
        key: request.key,
        lockMs: 2_000,
        waitTimeoutMs: 12_000,
        readAfterWait: async (minimumAt) => {
          const hit = await getSharedCache(cacheKey, (value) => typeof value === "string" ? value : null);
          send({ type: "cache-read", requestId: request.requestId, minimumAt, cachedAt: hit?.cachedAt ?? null });
          // REFRESH accepts the observed leader's publication, including equality
          // at its start boundary; an older cached value cannot satisfy it.
          return hit && hit.cachedAt >= minimumAt ? hit.value : null;
        },
        operation: async () => {
          const countKey = `${namespace}:test:provider-calls:${request.key}`;
          const count = await client.incr(countKey);
          await client.expire(countKey, 60);
          const token = await client.get(`${namespace}:lock:${request.key}`);
          const lockStartedAt = token ? Number(token.slice(0, token.indexOf(":"))) : null;
          send({ type: "operation-started", requestId: request.requestId, count, token, lockStartedAt, at: Date.now() });
          if (request.behavior === "hang") await new Promise<never>(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, request.delayMs));
          send({ type: "operation-ready", requestId: request.requestId, at: Date.now() });
          // The parent releases the operation only after the other process has
          // observed this owner's lease. Delays exercise renewal, not ordering.
          if (release) await release;
          if (request.behavior === "fail") throw new Error("Fixture provider failure.");
          const cachedAt = request.publishAtLockStart && lockStartedAt !== null ? lockStartedAt : Date.now();
          await setSharedCache(cacheKey, request.value, 60, cachedAt);
          send({ type: "published", requestId: request.requestId, cachedAt });
          return request.value;
        },
      });
      send({ type: "result", requestId: request.requestId, value: result });
    } catch (error) {
      send({ type: "request-error", requestId: request.requestId, message: error instanceof Error ? error.message : "Fixture request failed." });
    } finally {
      releases.delete(request.requestId);
    }
  });
  send({ type: "ready" });
}

void main().catch(() => {
  send({ type: "fatal", message: "The isolated Redis worker could not start." });
  process.exitCode = 1;
  process.disconnect?.();
});
