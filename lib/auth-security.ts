import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSecureSecret } from "@/lib/security-config";

type RateLimitOptions = {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
  blockMs: number;
};

let lastRateLimitCleanupAt = 0;

function rateLimitPepper() {
  return process.env.AUTH_RATE_LIMIT_PEPPER
    ? requireSecureSecret("AUTH_RATE_LIMIT_PEPPER")
    : requireSecureSecret("AUTH_SECRET");
}

async function identifierHash(scope: string, identifier: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(rateLimitPepper()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${scope}:${identifier.trim().toLowerCase()}`),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function clientIpFromHeaders(headers: Headers) {
  if (process.env.AUTH_TRUST_PROXY !== "true") return null;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headers.get("x-real-ip")?.trim();
  const value = forwarded || realIp;
  return value && value.length <= 64 ? value : null;
}

async function lockRateLimitBucket(tx: Prisma.TransactionClient, scope: string, key: string) {
  await tx.$queryRaw`
    SELECT 1::int AS "locked"
    FROM pg_advisory_xact_lock(hashtextextended(${`${scope}:${key}`}, 0))
  `;
}

export async function consumeAuthRateLimit({
  scope,
  identifier,
  limit,
  windowMs,
  blockMs,
}: RateLimitOptions) {
  const key = await identifierHash(scope, identifier);
  const now = new Date();
  if (now.getTime() - lastRateLimitCleanupAt >= 60 * 60_000) {
    lastRateLimitCleanupAt = now.getTime();
    await prisma.authRateLimit.deleteMany({
      where: { updatedAt: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60_000) } },
    });
  }

  // Serialize only callers updating the same bucket. Serializable transactions
  // across independent buckets can conflict during parallel registration checks.
  return prisma.$transaction(async (tx) => {
    await lockRateLimitBucket(tx, scope, key);
    // The row lock also protects this read/update from expired-bucket cleanup.
    const [current] = await tx.$queryRaw<Array<{
      attempts: number; windowStartedAt: Date; blockedUntil: Date | null;
    }>>`
      SELECT "attempts", "windowStartedAt", "blockedUntil"
      FROM "AuthRateLimit"
      WHERE "scope" = ${scope} AND "key" = ${key}
      FOR UPDATE
    `;

    if (current?.blockedUntil && current.blockedUntil > now) {
      return { allowed: false, retryAfterMs: current.blockedUntil.getTime() - now.getTime() };
    }

    const windowExpired = !current || now.getTime() - current.windowStartedAt.getTime() >= windowMs;
    if (windowExpired) {
      await tx.authRateLimit.upsert({
        where: { scope_key: { scope, key } },
        create: {
          scope,
          key,
          attempts: 1,
          windowStartedAt: now,
          lastAttemptAt: now,
        },
        update: {
          attempts: 1,
          windowStartedAt: now,
          lastAttemptAt: now,
          blockedUntil: null,
        },
      });
      return { allowed: true, retryAfterMs: 0 };
    }

    const attempts = current.attempts + 1;
    const blockedUntil = attempts > limit ? new Date(now.getTime() + blockMs) : null;
    await tx.authRateLimit.update({
      where: { scope_key: { scope, key } },
      data: { attempts, lastAttemptAt: now, blockedUntil },
    });
    return {
      allowed: attempts <= limit,
      retryAfterMs: blockedUntil ? blockedUntil.getTime() - now.getTime() : 0,
    };
  }, { isolationLevel: "ReadCommitted" });
}

export async function clearAuthRateLimit(scope: string, identifier: string) {
  const key = await identifierHash(scope, identifier);
  await prisma.$transaction(async (tx) => {
    await lockRateLimitBucket(tx, scope, key);
    await tx.authRateLimit.deleteMany({ where: { scope, key } });
  }, { isolationLevel: "ReadCommitted" });
}

export async function checkLoginRateLimit(email: string, headers: Headers) {
  const [account, global] = await Promise.all([
    consumeAuthRateLimit({
      scope: "login-account",
      identifier: email,
      limit: 8,
      windowMs: 15 * 60_000,
      blockMs: 30 * 60_000,
    }),
    consumeAuthRateLimit({
      scope: "login-global",
      identifier: "application",
      limit: 300,
      windowMs: 15 * 60_000,
      blockMs: 15 * 60_000,
    }),
  ]);
  const ip = clientIpFromHeaders(headers);
  const address = ip
    ? await consumeAuthRateLimit({
        scope: "login-ip",
        identifier: ip,
        limit: 30,
        windowMs: 15 * 60_000,
        blockMs: 30 * 60_000,
      })
    : { allowed: true, retryAfterMs: 0 };
  return account.allowed && address.allowed && global.allowed;
}

export async function checkRegistrationRateLimit(email: string, inviteToken: string, headers: Headers) {
  const [account, invite, global] = await Promise.all([
    consumeAuthRateLimit({
      scope: "register-account",
      identifier: email,
      limit: 3,
      windowMs: 60 * 60_000,
      blockMs: 60 * 60_000,
    }),
    consumeAuthRateLimit({
      scope: "register-invite",
      identifier: inviteToken,
      limit: 5,
      windowMs: 60 * 60_000,
      blockMs: 60 * 60_000,
    }),
    consumeAuthRateLimit({
      scope: "register-global",
      identifier: "application",
      limit: 50,
      windowMs: 60 * 60_000,
      blockMs: 60 * 60_000,
    }),
  ]);
  const ip = clientIpFromHeaders(headers);
  const address = ip
    ? await consumeAuthRateLimit({
        scope: "register-ip",
        identifier: ip,
        limit: 20,
        windowMs: 60 * 60_000,
        blockMs: 60 * 60_000,
      })
    : { allowed: true, retryAfterMs: 0 };
  return account.allowed && invite.allowed && address.allowed && global.allowed;
}
