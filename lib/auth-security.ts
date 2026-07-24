import { Prisma } from "@prisma/client";
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

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.authRateLimit.findUnique({
          where: { scope_key: { scope, key } },
        });

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
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2034";
      if (!retryable || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }

  throw new Error("Não foi possível registrar o limite de solicitações.");
}

export async function clearAuthRateLimit(scope: string, identifier: string) {
  const key = await identifierHash(scope, identifier);
  await prisma.authRateLimit.deleteMany({ where: { scope, key } });
}

export async function checkLoginRateLimit(email: string, headers: Headers) {
  const account = await consumeAuthRateLimit({
    scope: "login-account",
    identifier: email,
    limit: 8,
    windowMs: 15 * 60_000,
    blockMs: 30 * 60_000,
  });
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
  return account.allowed && address.allowed;
}

export async function checkRegistrationRateLimit(email: string, headers: Headers) {
  const account = await consumeAuthRateLimit({
    scope: "register-account",
    identifier: email,
    limit: 3,
    windowMs: 60 * 60_000,
    blockMs: 60 * 60_000,
  });
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
  return account.allowed && address.allowed;
}
