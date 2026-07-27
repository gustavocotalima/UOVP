import { createHash } from "node:crypto";

export function anonymizedUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

export function logIntegrationRefresh(event: Record<string, unknown>) {
  console.info(JSON.stringify(event));
}
