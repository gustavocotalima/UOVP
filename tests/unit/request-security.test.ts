import { afterEach, describe, expect, it } from "vitest";
import { isSameOriginRequest, secretsMatch } from "@/lib/request-security";

describe("segurança das rotas de integração", () => {
  const authUrl = process.env.AUTH_URL;
  const trustProxy = process.env.AUTH_TRUST_PROXY;

  afterEach(() => {
    if (authUrl === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = authUrl;
    if (trustProxy === undefined) delete process.env.AUTH_TRUST_PROXY;
    else process.env.AUTH_TRUST_PROXY = trustProxy;
  });

  it("aceita apenas POSTs originados pelo próprio host", () => {
    delete process.env.AUTH_URL;
    process.env.AUTH_TRUST_PROXY = "false";
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

  it("não confia em cabeçalhos encaminhados sem a configuração de proxy", () => {
    delete process.env.AUTH_URL;
    process.env.AUTH_TRUST_PROXY = "false";
    const spoofed = new Request("http://internal:3000/api/pluggy/sync", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
      },
    });
    expect(isSameOriginRequest(spoofed)).toBe(false);
  });

  it("aceita a origem encaminhada somente quando o proxy é confiável", () => {
    delete process.env.AUTH_URL;
    process.env.AUTH_TRUST_PROXY = "true";
    const request = new Request("http://internal:3000/api/pluggy/sync", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        "x-forwarded-host": "app.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it("usa a origem pública configurada, incluindo o protocolo", () => {
    process.env.AUTH_URL = "https://app.example.com";
    const valid = new Request("http://internal:3000/api/pluggy/sync", {
      method: "POST",
      headers: { origin: "https://app.example.com" },
    });
    const invalidScheme = new Request("http://internal:3000/api/pluggy/sync", {
      method: "POST",
      headers: { origin: "http://app.example.com" },
    });
    expect(isSameOriginRequest(valid)).toBe(true);
    expect(isSameOriginRequest(invalidScheme)).toBe(false);
  });

  it("compara o segredo do webhook sem aceitar prefixos ou tamanhos diferentes", () => {
    expect(secretsMatch("segredo-longo", "segredo-longo")).toBe(true);
    expect(secretsMatch("segredo", "segredo-longo")).toBe(false);
    expect(secretsMatch(null, "segredo-longo")).toBe(false);
  });
});
