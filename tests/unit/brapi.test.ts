import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAvailableBrapiQuotes, fetchBrapiQuotes, isBrapiOddLotSymbol, normalizeBrapiSymbol, searchBrapiEtfTickers, searchBrapiTickers } from "@/features/portfolio/brapi";
import { decryptCredential, encryptCredential } from "@/lib/credential-cipher";

const originalCredentialKeys = process.env.CREDENTIAL_ENCRYPTION_KEYS;
const originalActiveKey = process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY;

afterEach(() => {
  if (originalCredentialKeys === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEYS;
  else process.env.CREDENTIAL_ENCRYPTION_KEYS = originalCredentialKeys;
  if (originalActiveKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY = originalActiveKey;
});

describe("integração brapi", () => {
  it("busca o catálogo público para o autocomplete sem enviar a chave do usuário", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [
        {
          symbol: "XPETR",
          name: "XPETR",
          longName: "Outro ativo",
          assetType: "stock",
          subType: "stock",
          exchange: "B3",
          currency: "BRL",
          quote: { lastPrice: 12.34 },
        },
        {
          symbol: "PETR4",
          name: "PETR4",
          longName: "Petróleo Brasileiro S.A. - Petrobras",
          assetType: "stock",
          subType: "stock",
          exchange: "B3",
          currency: "BRL",
          logoUrl: "https://icons.brapi.dev/icons/PETR4.svg",
          quote: { lastPrice: 39.12 },
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const results = await searchBrapiTickers({ query: "petr", fetcher });

    const [url, request] = vi.mocked(fetcher).mock.calls[0];
    expect(String(url)).toBe("https://brapi.dev/api/v2/tickers?search=petr&sortBy=symbol&sortOrder=asc&limit=12");
    expect(new Headers(request?.headers).get("Authorization")).toBeNull();
    expect(results[0]).toEqual({
      symbol: "PETR4",
      name: "Petróleo Brasileiro S.A. - Petrobras",
      assetType: "stock",
      subType: "stock",
      currency: "BRL",
      lastPrice: 39.12,
      logoUrl: "https://icons.brapi.dev/icons/PETR4.svg",
    });
  });

  it("filtra o catálogo por fundos imobiliários no autocomplete de FIIs", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        symbol: "HGLG11",
        name: "HGLG11",
        longName: "Patria Log Fundo de Investimento Imobiliário",
        assetType: "fund",
        subType: "fii",
        exchange: "B3",
        currency: "BRL",
        quote: { lastPrice: 147.97 },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const results = await searchBrapiTickers({ query: "HGLG", subType: "fii", fetcher });

    const [url] = vi.mocked(fetcher).mock.calls[0];
    expect(String(url)).toBe("https://brapi.dev/api/v2/tickers?search=HGLG&sortBy=symbol&sortOrder=asc&limit=12&subType=fii");
    expect(results).toEqual([expect.objectContaining({ symbol: "HGLG11", subType: "fii", lastPrice: 147.97 })]);
  });

  it("faz fallback exato para ETF classificado pela brapi como fund sem subtipo", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const results = url.searchParams.get("subType") === "etf" ? [] : [{
        symbol: "AUPO11",
        name: "AUPO11",
        longName: "Investo ETF",
        assetType: "fund",
        subType: null,
        exchange: "B3",
        currency: "BRL",
      }];
      return new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const results = await searchBrapiEtfTickers({ query: "AUPO11", fetcher });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(results).toEqual([expect.objectContaining({ symbol: "AUPO11", assetType: "fund", subType: null })]);
    for (const [, request] of vi.mocked(fetcher).mock.calls) {
      expect(new Headers(request?.headers).get("Authorization")).toBeNull();
    }
  });

  it("remove códigos do mercado fracionário e normaliza entradas legadas", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { symbol: "ITSA3", name: "ITSA3", assetType: "stock", subType: "stock", currency: "BRL" },
        { symbol: "ITSA3F", name: "ITSA3F", assetType: "stock", subType: "stock", currency: "BRL" },
        { symbol: "ITSA4", name: "ITSA4", assetType: "stock", subType: "stock", currency: "BRL" },
        { symbol: "ITSA4F", name: "ITSA4F", assetType: "stock", subType: "stock", currency: "BRL" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const results = await searchBrapiTickers({ query: "ITAUSA", fetcher });

    expect(results.map((result) => result.symbol)).toEqual(["ITSA3", "ITSA4"]);
    expect(isBrapiOddLotSymbol("itsa4f.sa")).toBe(true);
    expect(normalizeBrapiSymbol("itsa4f.sa")).toBe("ITSA4");
  });

  it("consulta o endpoint v2 no backend usando Bearer e normaliza tickers da B3", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        requestedSymbol: "WEGE3",
        symbol: "WEGE3",
        changed: false,
        data: {
          shortName: "WEGE3",
          longName: "WEG S.A.",
          currency: "BRL",
          regularMarketPrice: 43.21,
          regularMarketTime: "2026-07-22T17:00:00.000Z",
          logourl: "https://icons.brapi.dev/icons/WEGE3.svg",
        },
      }],
      requestedAt: "2026-07-22T17:00:01.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const quotes = await fetchBrapiQuotes({ apiKey: "token-individual", tickers: ["wege3.sa"], fetcher });

    const [url, request] = vi.mocked(fetcher).mock.calls[0];
    expect(String(url)).toBe("https://brapi.dev/api/v2/stocks/quote?symbols=WEGE3");
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer token-individual");
    expect(quotes).toEqual([{
      requestedSymbol: "WEGE3",
      symbol: "WEGE3",
      name: "WEG S.A.",
      price: 43.21,
      currency: "BRL",
      logoUrl: "https://icons.brapi.dev/icons/WEGE3.svg",
      asOf: new Date("2026-07-22T17:00:00.000Z"),
    }]);
    expect(normalizeBrapiSymbol("wege3.sa")).toBe("WEGE3");
  });

  it("descarta cotação zero para preservar o último preço válido da carteira", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        requestedSymbol: "ZERO3",
        symbol: "ZERO3",
        data: {
          longName: "Cotação indisponível",
          currency: "BRL",
          regularMarketPrice: 0,
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    await expect(fetchBrapiQuotes({
      apiKey: "token-individual",
      tickers: ["ZERO3"],
      fetcher,
    })).resolves.toEqual([]);
  });

  it("traduz falhas de autenticação sem vazar a chave", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: true,
      message: "Token de autenticação inválido",
      code: "INVALID_TOKEN",
    }), { status: 401, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    await expect(fetchBrapiQuotes({ apiKey: "segredo", tickers: ["WEGE3"], fetcher }))
      .rejects.toEqual(expect.objectContaining({
        name: "BrapiApiError",
        message: "A chave da brapi é inválida ou expirou.",
        status: 401,
        code: "INVALID_TOKEN",
      }));
  });

  it("isola tickers inválidos sem impedir a atualização dos demais ativos", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const symbols = new URL(String(input)).searchParams.get("symbols")?.split(",") ?? [];
      if (symbols.includes("INVALID")) {
        return new Response(JSON.stringify({ error: true, code: "NOT_FOUND" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        results: symbols.map((symbol) => ({
          requestedSymbol: symbol,
          symbol,
          data: { longName: symbol, currency: "BRL", regularMarketPrice: 10 },
        })),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const quotes = await fetchAvailableBrapiQuotes({
      apiKey: "token-individual",
      tickers: ["WEGE3", "INVALID"],
      fetcher,
    });

    expect(quotes.map((quote) => quote.symbol)).toEqual(["WEGE3"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("protege a chave individual com criptografia autenticada", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEYS = `v1:${Buffer.alloc(32, 7).toString("base64url")}`;
    process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY = "v1";
    const context = { userId: "user-a", type: "brapi" as const };
    const encrypted = encryptCredential("brapi-token-do-usuario", context);

    expect(encrypted).not.toContain("brapi-token-do-usuario");
    expect(decryptCredential(encrypted, context)).toEqual({
      value: "brapi-token-do-usuario",
      needsRotation: false,
    });
    expect(() => decryptCredential(encrypted, { userId: "user-b", type: "brapi" })).toThrow();
  });

  it("marca credenciais para rotação quando a chave ativa muda", () => {
    const oldKey = Buffer.alloc(32, 3).toString("base64url");
    const newKey = Buffer.alloc(32, 9).toString("base64url");
    const context = { userId: "user-a", type: "brapi" as const };
    process.env.CREDENTIAL_ENCRYPTION_KEYS = `old:${oldKey},new:${newKey}`;
    process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY = "old";
    const encrypted = encryptCredential("token", context);

    process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY = "new";
    expect(decryptCredential(encrypted, context)).toEqual({
      value: "token",
      needsRotation: true,
    });
  });
});
