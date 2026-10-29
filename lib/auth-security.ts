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

  const windowCutoff = new Date(now.getTime() - windowMs);
  const nextBlockedUntil = new Date(now.getTime() + blockMs);

  // The unique bucket key serializes this single statement, without keeping a
  // Prisma interactive transaction open while waiting for locks or the client.
  const [bucket] = await prisma.$queryRaw<Array<{ blockedUntil: Date | null }>>`
    INSERT INTO "AuthRateLimit" AS bucket (
      "id", "scope", "key", "attempts", "windowStartedAt", "lastAttemptAt",
      "blockedUntil", "createdAt", "updatedAt"
    )
    VALUES (${crypto.randomUUID()}, ${scope}, ${key}, 1, ${now}, ${now}, NULL, ${now}, ${now})
    ON CONFLICT ("scope", "key") DO UPDATE
    SET
      "attempts" = CASE
        WHEN bucket."blockedUntil" > EXCLUDED."lastAttemptAt" THEN bucket."attempts"
        WHEN bucket."windowStartedAt" <= ${windowCutoff} THEN 1
        ELSE bucket."attempts" + 1
      END,
      "windowStartedAt" = CASE
        WHEN bucket."blockedUntil" > EXCLUDED."lastAttemptAt" THEN bucket."windowStartedAt"
        WHEN bucket."windowStartedAt" <= ${windowCutoff} THEN EXCLUDED."windowStartedAt"
        ELSE bucket."windowStartedAt"
      END,
      "lastAttemptAt" = CASE
        WHEN bucket."blockedUntil" > EXCLUDED."lastAttemptAt" THEN bucket."lastAttemptAt"
        ELSE EXCLUDED."lastAttemptAt"
      END,
      "blockedUntil" = CASE
        WHEN bucket."blockedUntil" > EXCLUDED."lastAttemptAt" THEN bucket."blockedUntil"
        WHEN bucket."windowStartedAt" <= ${windowCutoff} THEN NULL
        WHEN bucket."attempts" + 1 > ${limit} THEN ${nextBlockedUntil}
        ELSE NULL
      END,
      "updatedAt" = CASE
        WHEN bucket."blockedUntil" > EXCLUDED."lastAttemptAt" THEN bucket."updatedAt"
        ELSE EXCLUDED."updatedAt"
      END
    RETURNING "blockedUntil"
  `;

  if (!bucket) throw new Error("Não foi possível registrar a tentativa de autenticação.");
  return {
    allowed: bucket.blockedUntil === null,
    retryAfterMs: bucket.blockedUntil ? bucket.blockedUntil.getTime() - now.getTime() : 0,
  };
}

export async function clearAuthRateLimit(scope: string, identifier: string) {
  const key = await identifierHash(scope, identifier);
  await prisma.authRateLimit.deleteMany({ where: { scope, key } });
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
