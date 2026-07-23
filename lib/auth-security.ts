import { prisma } from "@/lib/prisma";

type RateLimitOptions = {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
  blockMs: number;
};

function rateLimitPepper() {
  const pepper = process.env.AUTH_RATE_LIMIT_PEPPER || process.env.AUTH_SECRET;
  if (!pepper || pepper.length < 32 || pepper.includes("replace-with")) {
    throw new Error("Configure AUTH_RATE_LIMIT_PEPPER com pelo menos 32 caracteres aleatórios.");
  }
  return pepper;
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
  if (scope.endsWith("-global")) {
    await prisma.authRateLimit.deleteMany({
      where: { updatedAt: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60_000) } },
    });
  }

  return prisma.$transaction(async (tx) => {
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
}

export async function clearAuthRateLimit(scope: string, identifier: string) {
  const key = await identifierHash(scope, identifier);
  await prisma.authRateLimit.deleteMany({ where: { scope, key } });
}

export async function checkLoginRateLimit(email: string, headers: Headers) {
  const global = await consumeAuthRateLimit({
    scope: "login-global",
    identifier: "all",
    limit: 2_000,
    windowMs: 15 * 60_000,
    blockMs: 5 * 60_000,
  });
  if (!global.allowed) return false;
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
  const global = await consumeAuthRateLimit({
    scope: "register-global",
    identifier: "all",
    limit: 200,
    windowMs: 60 * 60_000,
    blockMs: 15 * 60_000,
  });
  if (!global.allowed) return false;
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
