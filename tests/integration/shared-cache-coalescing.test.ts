import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "redis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SharedCacheWorkerRequest } from "../fixtures/shared-cache-worker";

const testRedisUrl = process.env.UOVP_TEST_REDIS_URL?.trim();
const suite = testRedisUrl ? describe : describe.skip;
type WorkerMessage = { type: string } & Record<string, unknown>;

function isWorkerMessage(value: unknown): value is WorkerMessage {
  return Boolean(value && typeof value === "object" && "type" in value && typeof value.type === "string");
}

function startWorker(namespace: string) {
  const child = fork(path.resolve(process.cwd(), "tests/fixtures/shared-cache-worker.ts"), [], {
    cwd: process.cwd(),
    execArgv: ["--import", "tsx"],
    env: { ...process.env, UOVP_TEST_REDIS_URL: testRedisUrl, REDIS_URL: testRedisUrl, SHARED_CACHE_NAMESPACE: namespace },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const messages: WorkerMessage[] = [];
  const waiters = new Set<{ matches: (message: WorkerMessage) => boolean; resolve: (message: WorkerMessage) => void; reject: (error: Error) => void }>();
  let output = "";
  let ended = false;
  child.stdout?.on("data", (chunk) => { output = (output + String(chunk)).slice(-2_000); });
  child.stderr?.on("data", (chunk) => { output = (output + String(chunk)).slice(-2_000); });
  child.on("message", (message: unknown) => {
    if (!isWorkerMessage(message)) return;
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.matches(message)) waiter.resolve(message);
      else if (message.type === "fatal") waiter.reject(new Error(`Redis worker failed to start. ${output}`));
    }
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => {
      ended = true;
      for (const waiter of [...waiters]) waiter.reject(new Error(`Redis worker exited (${code ?? signal}). ${output}`));
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      ended = true;
      for (const waiter of [...waiters]) waiter.reject(error);
      resolve({ code: null, signal: null });
    });
  });
  async function waitFor(type: string, requestId?: string, timeoutMs = 15_000) {
    const matches = (message: WorkerMessage) => message.type === type && (requestId === undefined || message.requestId === requestId);
    const received = messages.find(matches);
    if (received) return received;
    if (ended) throw new Error(`Redis worker has already exited. ${output}`);
    return new Promise<WorkerMessage>((resolve, reject) => {
      const finish = (result: WorkerMessage | Error) => {
        clearTimeout(timer);
        waiters.delete(waiter);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const waiter = { matches, resolve: (message: WorkerMessage) => finish(message), reject: (error: Error) => finish(error) };
      const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${type}. ${output}`)), timeoutMs);
      waiters.add(waiter);
    });
  }
  return {
    child, messages, exited, waitFor,
    run(request: Omit<SharedCacheWorkerRequest, "type">) { child.send({ type: "run", ...request }); },
    release(requestId: string) { child.send({ type: "release", requestId }); },
    async stop() {
      if (ended) return;
      child.kill("SIGKILL");
      await exited;
    },
  };
}

suite("coalescência Redis real entre processos independentes", () => {
  const control = testRedisUrl ? createClient({ url: testRedisUrl, socket: { connectTimeout: 2_000, reconnectStrategy: false } }) : null;
  const workers: ReturnType<typeof startWorker>[] = [];
  const namespaces: string[] = [];

  beforeAll(async () => {
    const url = new URL(testRedisUrl!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("UOVP_TEST_REDIS_URL must point to an isolated loopback Redis instance.");
    control!.on("error", () => undefined);
    await control!.connect();
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.stop()));
    for (const namespace of namespaces.splice(0)) {
      const keys = await control!.keys(`${namespace}:*`);
      if (keys.length) await control!.del(keys);
    }
  });

  afterAll(() => { if (control?.isOpen) control.destroy(); });

  async function fixture() {
    const namespace = `uovp:redis-integration:${randomUUID()}`;
    namespaces.push(namespace);
    const leader = startWorker(namespace);
    const follower = startWorker(namespace);
    workers.push(leader, follower);
    await Promise.all([leader.waitFor("ready"), follower.waitFor("ready")]);
    const key = "public-price";
    return { namespace, key, leader, follower, lockKey: `${namespace}:lock:${key}`, countKey: `${namespace}:test:provider-calls:${key}`, cacheKey: `${namespace}:result:${key}` };
  }

  it("renova um lease de 2s por mais de 4s e compartilha REFRESH iniciado antes do seguidor", async () => {
    const f = await fixture();
    const staleCachedAt = Date.now() - 60_000;
    await control!.set(f.cacheKey, JSON.stringify({ cachedAt: staleCachedAt, value: "stale" }), { EX: 60 });
    f.leader.run({ requestId: "leader", key: f.key, value: "leader-value", delayMs: 4_500, publishAtLockStart: true, waitForRelease: true });
    const started = await f.leader.waitFor("operation-started", "leader");
    expect(started.token).toEqual(expect.any(String));
    const ready = await f.leader.waitFor("operation-ready", "leader");
    expect(Number(ready.at) - Number(started.at)).toBeGreaterThan(4_000);
    // More than two original TTLs have passed. IPC keeps publication blocked
    // while the follower starts and confirms it observed this same owner.
    expect(await control!.get(f.lockKey)).toBe(started.token);
    expect(await control!.pTTL(f.lockKey)).toBeGreaterThan(0);
    f.follower.run({ requestId: "follower", key: f.key, value: "duplicate", delayMs: 0 });
    const followerStarted = await f.follower.waitFor("request-started", "follower");
    expect(followerStarted.at).toEqual(expect.any(Number));
    const waiting = await f.follower.waitFor("cache-read", "follower");
    expect(waiting.minimumAt).toBe(started.lockStartedAt);
    expect(waiting.cachedAt).toBe(staleCachedAt);
    expect(await control!.get(f.lockKey)).toBe(started.token);
    expect(f.leader.messages.some((message) => message.type === "published")).toBe(false);
    expect(await control!.get(f.countKey)).toBe("1");
    f.leader.release("leader");
    const results = await Promise.all([f.leader.waitFor("result", "leader"), f.follower.waitFor("result", "follower")]);

    expect(results.map((row) => row.value)).toEqual(["leader-value", "leader-value"]);
    expect(await control!.get(f.countKey)).toBe("1");
    expect(f.follower.messages.some((message) => message.type === "operation-started")).toBe(false);
    const published = await f.leader.waitFor("published", "leader");
    expect(published.cachedAt).toBe(started.lockStartedAt);
    expect(Number(published.cachedAt)).toBeLessThan(Number(followerStarted.at));
    expect(f.follower.messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: "cache-read", minimumAt: started.lockStartedAt, cachedAt: started.lockStartedAt })]));
    expect(await control!.get(f.lockKey)).toBeNull();
  });

  it("assume com NX após saída abrupta do líder e expiração real do TTL", async () => {
    const f = await fixture();
    f.leader.run({ requestId: "crashed", key: f.key, value: "never-published", delayMs: 0, behavior: "hang" });
    const original = await f.leader.waitFor("operation-started", "crashed");
    f.follower.run({ requestId: "recovery", key: f.key, value: "recovered", delayMs: 0 });
    const waiting = await f.follower.waitFor("cache-read", "recovery");
    expect(waiting.minimumAt).toBe(original.lockStartedAt);
    expect(await control!.get(f.lockKey)).toBe(original.token);
    f.leader.child.kill("SIGKILL");
    expect(await f.leader.exited).toMatchObject({ signal: "SIGKILL" });

    const result = await f.follower.waitFor("result", "recovery");
    const successor = await f.follower.waitFor("operation-started", "recovery");

    expect(result.value).toBe("recovered");
    expect(successor.token).toEqual(expect.any(String));
    expect(successor.token).not.toBe(original.token);
    expect(successor.count).toBe(2);
    expect(await control!.get(f.countKey)).toBe("2");
    expect(f.leader.messages.some((message) => message.type === "published")).toBe(false);
    expect(await control!.get(f.lockKey)).toBeNull();
  });

  it("libera o lock após falha do provedor e permite que o seguidor recupere a consulta", async () => {
    const f = await fixture();
    f.leader.run({ requestId: "failed", key: f.key, value: "never-published", delayMs: 0, behavior: "fail", waitForRelease: true });
    const started = await f.leader.waitFor("operation-started", "failed");
    await f.leader.waitFor("operation-ready", "failed");
    f.follower.run({ requestId: "after-failure", key: f.key, value: "healthy", delayMs: 0 });
    const waiting = await f.follower.waitFor("cache-read", "after-failure");
    expect(waiting.minimumAt).toBe(started.lockStartedAt);
    expect(await control!.get(f.lockKey)).toBe(started.token);
    f.leader.release("failed");
    const results = await Promise.all([f.leader.waitFor("request-error", "failed"), f.follower.waitFor("result", "after-failure")]);

    expect(results[0].message).toBe("Fixture provider failure.");
    expect(results[1].value).toBe("healthy");
    expect(await control!.get(f.countKey)).toBe("2");
    expect(await control!.get(f.lockKey)).toBeNull();
  });
});
