import { timingSafeEqual } from "node:crypto";

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const configuredOrigin = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : null;
    let expectedOrigin = configuredOrigin ?? requestUrl.origin;
    if (!configuredOrigin && process.env.AUTH_TRUST_PROXY === "true") {
      const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
      const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
      if (forwardedHost && (forwardedProtocol === "http" || forwardedProtocol === "https")) {
        expectedOrigin = `${forwardedProtocol}://${forwardedHost}`;
      }
    }
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function secretsMatch(left: string | null, right: string | undefined) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
