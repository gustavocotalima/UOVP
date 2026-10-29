import { createPrismaClient } from "../../lib/prisma-client";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { clearAuthRateLimit, consumeAuthRateLimit } from "@/lib/auth-security";
import { prisma } from "@/lib/prisma";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const prefix = `rate-test-${randomUUID()}`;
const options = { identifier: "test", limit: 8, windowMs: 60_000, blockMs: 120_000 };

suite("atomic rate-limit buckets", () => {
  afterAll(async () => {
    await prisma.authRateLimit.deleteMany({ where: { scope: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  it("counts concurrent requests exactly and preserves an active block", async () => {
    const scope = `${prefix}-same`;
    const results = await Promise.all(Array.from({ length: 32 }, () => consumeAuthRateLimit({ ...options, scope })));
    expect(results.filter((result) => result.allowed)).toHaveLength(8);
    expect(results.filter((result) => !result.allowed)).toHaveLength(24);
    const blocked = await prisma.authRateLimit.findFirstOrThrow({ where: { scope } });
    expect(blocked.attempts).toBe(9);
    expect(blocked.blockedUntil).not.toBeNull();

    expect(await consumeAuthRateLimit({ ...options, scope })).toMatchObject({ allowed: false });
    const unchanged = await prisma.authRateLimit.findUniqueOrThrow({ where: { id: blocked.id } });
    expect(unchanged.attempts).toBe(9);
    expect(unchanged.blockedUntil).toEqual(blocked.blockedUntil);
  });

  it("preserves every bucket timestamp when an active block outlasts the window", async () => {
    const scope = `${prefix}-blocked-expired-window`;
    await consumeAuthRateLimit({ ...options, scope });
    const now = Date.now();
    await prisma.authRateLimit.updateMany({ where: { scope }, data: {
      attempts: options.limit + 1,
      windowStartedAt: new Date(now - 120_000),
      lastAttemptAt: new Date(now - 30_000),
      blockedUntil: new Date(now + options.blockMs),
      updatedAt: new Date(now - 30_000),
    } });
    const before = await prisma.authRateLimit.findFirstOrThrow({ where: { scope } });

    const result = await consumeAuthRateLimit({ ...options, scope });

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(await prisma.authRateLimit.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
  });

  it("increments and blocks again when a block expires before its window", async () => {
    const scope = `${prefix}-expired-block`;
    await consumeAuthRateLimit({ ...options, scope });
    const now = Date.now();
    const previousAttempt = new Date(now - 20_000);
    await prisma.authRateLimit.updateMany({ where: { scope }, data: {
      attempts: options.limit + 1,
      windowStartedAt: previousAttempt,
      lastAttemptAt: previousAttempt,
      blockedUntil: new Date(now - 1_000),
      updatedAt: previousAttempt,
    } });
    const before = await prisma.authRateLimit.findFirstOrThrow({ where: { scope } });

    expect(await consumeAuthRateLimit({ ...options, scope })).toEqual({
      allowed: false,
      retryAfterMs: options.blockMs,
    });
    const after = await prisma.authRateLimit.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.attempts).toBe(before.attempts + 1);
    expect(after.windowStartedAt).toEqual(before.windowStartedAt);
    expect(after.lastAttemptAt.getTime()).toBeGreaterThan(before.lastAttemptAt.getTime());
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.blockedUntil!.getTime() - after.lastAttemptAt.getTime()).toBe(options.blockMs);
  });

  it("handles independent buckets in parallel without serialization failures", async () => {
    const results = await Promise.all(Array.from({ length: 48 }, (_, index) =>
      consumeAuthRateLimit({ ...options, scope: `${prefix}-independent-${index % 12}` }),
    ));
    expect(results.every((result) => result.allowed)).toBe(true);
    const buckets = await prisma.authRateLimit.findMany({ where: { scope: { startsWith: `${prefix}-independent-` } } });
    expect(buckets).toHaveLength(12);
    expect(buckets.every((bucket) => bucket.attempts === 4)).toBe(true);
  });

  it("resets an expired window once under concurrent requests", async () => {
    const scope = `${prefix}-expired`;
    await consumeAuthRateLimit({ ...options, scope });
    await prisma.authRateLimit.updateMany({ where: { scope }, data: {
      attempts: 100,
      windowStartedAt: new Date(Date.now() - 120_000),
      blockedUntil: new Date(Date.now() - 1_000),
    } });
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      consumeAuthRateLimit({ ...options, scope, limit: 3 }),
    ));
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    const bucket = await prisma.authRateLimit.findFirstOrThrow({ where: { scope } });
    expect(bucket.attempts).toBe(4);
    expect(bucket.blockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("serializes successful-login resets with concurrent attempts", async () => {
    const scope = `${prefix}-clear`;
    await consumeAuthRateLimit({ ...options, scope });
    await Promise.all(Array.from({ length: 32 }, (_, index) => index % 4 === 0
      ? clearAuthRateLimit(scope, options.identifier)
      : consumeAuthRateLimit({ ...options, scope }),
    ));
    await clearAuthRateLimit(scope, options.identifier);
    expect(await consumeAuthRateLimit({ ...options, scope })).toMatchObject({ allowed: true });
    const bucket = await prisma.authRateLimit.findFirstOrThrow({ where: { scope } });
    expect(bucket.attempts).toBe(1);
    expect(bucket.blockedUntil).toBeNull();
  });

  it("preserves attempts when expired-bucket cleanup runs concurrently", async () => {
    const scope = `${prefix}-cleanup`;
    await consumeAuthRateLimit({ ...options, scope });
    const expired = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    await prisma.authRateLimit.updateMany({ where: { scope }, data: {
      attempts: 100, windowStartedAt: expired, updatedAt: expired,
    } });
    const calls = Array.from({ length: 32 }, () => consumeAuthRateLimit({ ...options, scope, limit: 100 }));
    await Promise.all([
      ...calls,
      prisma.authRateLimit.deleteMany({ where: { scope, updatedAt: { lte: expired } } }),
    ]);
    const bucket = await prisma.authRateLimit.findFirstOrThrow({ where: { scope } });
    expect(bucket.attempts).toBe(32);
    expect(bucket.blockedUntil).toBeNull();
  });

  it.each(["consume", "clear"] as const)("allows %s to wait beyond the default transaction timeout", async (operation) => {
    const scope = `${prefix}-contention-${operation}`;
    await consumeAuthRateLimit({ ...options, scope });
    const bucket = await prisma.authRateLimit.findFirstOrThrow({ where: { scope } });
    let notifyLocked!: () => void;
    let rejectLocked!: (reason: unknown) => void;
    const locked = new Promise<void>((resolve, reject) => {
      notifyLocked = resolve;
      rejectLocked = reject;
    });
    // Use another pool so the request reaches PostgreSQL even with connection_limit=1.
    const holderPrisma = createPrismaClient();
    const holder = holderPrisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "AuthRateLimit" WHERE "id" = ${bucket.id} FOR UPDATE
      `;
      notifyLocked();
      // Keep the real database lock longer than Prisma's default 5-second transaction timeout.
      await tx.$queryRaw`SELECT 1::int AS "slept" FROM pg_sleep(7)`;
    }, { timeout: 20_000 }).catch((error) => {
      rejectLocked(error);
      throw error;
    }).finally(() => holderPrisma.$disconnect());
    const request = locked.then(async () => {
      const startedAt = Date.now();
      if (operation === "consume") {
        expect(await consumeAuthRateLimit({ ...options, scope })).toEqual({ allowed: true, retryAfterMs: 0 });
      } else {
        await clearAuthRateLimit(scope, options.identifier);
      }
      return Date.now() - startedAt;
    });

    // Settle both sides even if either fails, so no lock holder or request leaks into the next test.
    const [holderResult, requestResult] = await Promise.allSettled([holder, request]);
    if (holderResult.status === "rejected") throw holderResult.reason;
    if (requestResult.status === "rejected") throw requestResult.reason;
    expect(requestResult.value).toBeGreaterThan(5_000);
    if (operation === "consume") {
      expect(await prisma.authRateLimit.findUniqueOrThrow({ where: { id: bucket.id } })).toMatchObject({
        attempts: 2,
        blockedUntil: null,
      });
    } else {
      expect(await prisma.authRateLimit.count({ where: { scope } })).toBe(0);
    }
  }, 30_000);
});
