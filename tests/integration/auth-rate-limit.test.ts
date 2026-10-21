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
});
