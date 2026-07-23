import { describe, expect, it } from "vitest";
import { isSameOriginRequest, secretsMatch } from "@/lib/request-security";

describe("segurança das rotas de integração", () => {
  it("aceita apenas POSTs originados pelo próprio host", () => {
    const valid = new Request("https://app.example.com/api/pluggy/sync", {
      method: "POST",
      headers: { origin: "https://app.example.com", host: "app.example.com" },
    });
    const invalid = new Request("https://app.example.com/api/pluggy/sync", {
      method: "POST",
      headers: { origin: "https://attacker.example", host: "app.example.com" },
    });

    expect(isSameOriginRequest(valid)).toBe(true);
    expect(isSameOriginRequest(invalid)).toBe(false);
  });

  it("compara o segredo do webhook sem aceitar prefixos ou tamanhos diferentes", () => {
    expect(secretsMatch("segredo-longo", "segredo-longo")).toBe(true);
    expect(secretsMatch("segredo", "segredo-longo")).toBe(false);
    expect(secretsMatch(null, "segredo-longo")).toBe(false);
  });
});
