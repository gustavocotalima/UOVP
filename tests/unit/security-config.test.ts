import { afterEach, describe, expect, it } from "vitest";
import { requireSecureSecret } from "@/lib/security-config";

describe("configuração de segredos", () => {
  const original = process.env.TEST_RUNTIME_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.TEST_RUNTIME_SECRET;
    else process.env.TEST_RUNTIME_SECRET = original;
  });

  it("rejeita segredos ausentes, curtos e valores de exemplo", () => {
    delete process.env.TEST_RUNTIME_SECRET;
    expect(() => requireSecureSecret("TEST_RUNTIME_SECRET")).toThrow();
    process.env.TEST_RUNTIME_SECRET = "curto";
    expect(() => requireSecureSecret("TEST_RUNTIME_SECRET")).toThrow();
    process.env.TEST_RUNTIME_SECRET = "replace-with-at-least-32-random-characters";
    expect(() => requireSecureSecret("TEST_RUNTIME_SECRET")).toThrow();
  });

  it("aceita um segredo longo sem marcador de exemplo", () => {
    process.env.TEST_RUNTIME_SECRET = "0zHd9MbQvK4V0HP2uX35Vc8SN7yFPmERm5HehV2Yb4w";
    expect(requireSecureSecret("TEST_RUNTIME_SECRET")).toBe(process.env.TEST_RUNTIME_SECRET);
  });
});
