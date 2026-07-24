import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-security", () => ({
  clientIpFromHeaders: () => null,
  consumeAuthRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
}));

import {
  MAX_PLUGGY_WEBHOOK_BODY_BYTES,
  POST,
} from "@/app/api/pluggy/webhook/route";

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://app.example.com/api/pluggy/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

function validPayload() {
  return {
    event: "item/updated",
    eventId: randomUUID(),
    itemId: randomUUID(),
    clientUserId: "test-user",
  };
}

describe("entrada do webhook Pluggy", () => {
  it("rejeita Content-Length acima do limite antes de ler o JSON", async () => {
    const response = await POST(request("{}", {
      "content-length": String(MAX_PLUGGY_WEBHOOK_BODY_BYTES + 1),
    }));

    expect(response.status).toBe(413);
  });

  it("interrompe corpo em streaming que ultrapassa o limite", async () => {
    const body = JSON.stringify({
      ...validPayload(),
      padding: "x".repeat(MAX_PLUGGY_WEBHOOK_BODY_BYTES),
    });
    const response = await POST(request(body));

    expect(response.status).toBe(413);
  });

  it("exige JSON", async () => {
    const response = await POST(request("{}", { "content-type": "text/plain" }));

    expect(response.status).toBe(415);
  });

  it("rejeita eventos que o produto não processa", async () => {
    const response = await POST(request(JSON.stringify({
      ...validPayload(),
      event: "payment_intent/completed",
    })));

    expect(response.status).toBe(400);
  });

  it("rejeita campos de payload não permitidos", async () => {
    const response = await POST(request(JSON.stringify({
      ...validPayload(),
      unexpected: "value",
    })));

    expect(response.status).toBe(400);
  });
});
