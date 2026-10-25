import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAvailableBrapiQuotes, fetchBrapiQuotes, fetchBrapiTickerMetadata, isBrapiOddLotSymbol, normalizeBrapiSymbol, preferredBrapiLogoUrl, searchBrapiEtfTickers, searchBrapiTickers } from "@/features/portfolio/brapi";
import { normalizeBrapiPlan } from "@/features/portfolio/brapi-plans";
import { decryptCredential, encryptCredential } from "@/lib/credential-cipher";

const originalCredentialKeys = process.env.CREDENTIAL_ENCRYPTION_KEYS;
const originalActiveKey = process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY;

function quotePayload(symbol: string) {
  return {
    results: [{
      requestedSymbol: symbol,
      symbol,
      data: { longName: symbol, currency: "BRL", regularMarketPrice: 10 },
    }],
  };
}

function quoteResponse(symbol: string) {
  return new Response(JSON.stringify(quotePayload(symbol)), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function batchQuoteResponse(symbols: string[]) {
  return new Response(JSON.stringify({
    results: symbols.flatMap((symbol) => quotePayload(symbol).results),
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function requestedSymbols(input: string | URL | Request) {
  return new URL(String(input)).searchParams.get("symbols")?.split(",") ?? [];
}

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

  it("recupera pelo catálogo o logo legado associado ao ticker atual", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        symbol: "EMBJ3",
        name: "EMBJ3",
        longName: "Embraer S.A.",
        assetType: "stock",
        subType: "stock",
        exchange: "B3",
        currency: "BRL",
        logoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const results = await fetchBrapiTickerMetadata({
      tickers: ["embj3.sa", "EMBJ3"],
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results).toEqual([expect.objectContaining({
      symbol: "EMBJ3",
      logoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
    })]);
    expect(new Headers(vi.mocked(fetcher).mock.calls[0][1]?.headers).get("Authorization")).toBeNull();
  });

  it("prioriza o logo do catálogo quando a cotação aponta para um ticker legado inexistente", () => {
    expect(preferredBrapiLogoUrl({
      metadataLogoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
      quoteLogoUrl: "https://icons.brapi.dev/icons/EMBJ3.svg",
      existingLogoUrl: null,
    })).toBe("https://icons.brapi.dev/icons/EMBR3.svg");
  });

  it("ignora o placeholder genérico da brapi e preserva o logo específico existente", () => {
    expect(preferredBrapiLogoUrl({
      metadataLogoUrl: "https://icons.brapi.dev/icons/BRAPI.svg",
      quoteLogoUrl: "https://icons.brapi.dev/icons/brapi.svg",
      existingLogoUrl: "https://icons.brapi.dev/icons/SAPR4.svg",
    })).toBe("https://icons.brapi.dev/icons/SAPR4.svg");
  });

  it("não usa o logo da cotação como fonte canônica", () => {
    expect(preferredBrapiLogoUrl({
      metadataLogoUrl: null,
      quoteLogoUrl: "https://icons.brapi.dev/icons/EMBJ3.svg",
      existingLogoUrl: null,
    })).toBeNull();
  });

  it("remove o placeholder genérico retornado pelo catálogo", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        symbol: "SAPR4",
        name: "CIA SANEAMENTO DO PARANA - SANEPAR",
        longName: "Companhia de Saneamento do Parana - Sanepar",
        assetType: "stock",
        subType: "stock",
        exchange: "B3",
        currency: "BRL",
        logoUrl: "https://icons.brapi.dev/icons/BRAPI.svg",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const results = await searchBrapiTickers({ query: "SAPR4", fetcher });

    expect(results).toEqual([expect.objectContaining({
      symbol: "SAPR4",
      logoUrl: null,
    })]);
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

  it("consulta um ticker por requisição, preservando a ordem após normalização e deduplicação", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const symbol = new URL(String(input)).searchParams.get("symbols") ?? "";
      return quoteResponse(symbol);
    });

    const quotes = await fetchBrapiQuotes({
      apiKey: "token-individual",
      tickers: [" wege3.sa ", "WEGE3", "itsa4f.sa", "ITSA4F", "", "petr4"],
      fetcher,
    });

    expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("symbols")))
      .toEqual(["WEGE3", "ITSA4", "PETR4"]);
    expect(quotes.map((quote) => quote.symbol)).toEqual(["WEGE3", "ITSA4", "PETR4"]);
  });

  it("mantém os planos conhecidos e usa o gratuito para configurações ausentes ou inválidas", async () => {
    for (const plan of ["FREE", "STARTUP", "PRO"] as const) {
      expect(normalizeBrapiPlan(plan)).toBe(plan);
    }
    for (const plan of [undefined, null, "", "ENTERPRISE", 42, {}]) {
      expect(normalizeBrapiPlan(plan)).toBe("FREE");
    }
    const fetcher = vi.fn(async (input: string | URL | Request) => batchQuoteResponse(requestedSymbols(input)));

    await fetchBrapiQuotes({
      apiKey: "plano-invalido",
      plan: "ENTERPRISE" as Parameters<typeof fetchBrapiQuotes>[0]["plan"],
      tickers: ["WEGE3", "ITUB4"],
      fetcher,
    });

    expect(fetcher.mock.calls.map(([input]) => requestedSymbols(input))).toEqual([["WEGE3"], ["ITUB4"]]);
  });

  it.each([
    { plan: "STARTUP" as const, batchSize: 10 },
    { plan: "PRO" as const, batchSize: 20 },
  ])("$plan divide 53 tickers em lotes de até $batchSize e ordena respostas recebidas fora de ordem", async ({ plan, batchSize }) => {
    const tickers = Array.from({ length: 53 }, (_, index) => `TICK${index}`);
    const completed: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const symbols = requestedSymbols(input);
      for (let step = 0; step < (symbols[0] === tickers[0] ? 8 : 1); step += 1) await Promise.resolve();
      completed.push(symbols[0]);
      return batchQuoteResponse([...symbols].reverse());
    });

    const quotes = await fetchBrapiQuotes({ apiKey: `lotes-${plan}`, plan, tickers, fetcher });

    const batches = fetcher.mock.calls.map(([input]) => requestedSymbols(input));
    expect(batches).toHaveLength(Math.ceil(tickers.length / batchSize));
    expect(batches.every((symbols) => symbols.length > 0 && symbols.length <= batchSize)).toBe(true);
    expect(batches.flat().sort()).toEqual([...tickers].sort());
    expect(completed[0]).not.toBe(tickers[0]);
    expect(quotes.map((quote) => quote.symbol)).toEqual(tickers);
  });

  it.each([
    { plan: "STARTUP" as const, batchSize: 10, concurrency: 4 },
    { plan: "PRO" as const, batchSize: 20, concurrency: 16 },
  ])("$plan limita chamadas concorrentes da mesma chave a $concurrency, incluindo o consumo do JSON", async ({ plan, batchSize, concurrency }) => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const firstTickers = Array.from({ length: batchSize * concurrency }, (_, index) => `FIRST${index}`);
    const secondTickers = Array.from({ length: batchSize * concurrency }, (_, index) => `SECOND${index}`);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      const response = batchQuoteResponse(requestedSymbols(input));
      const readJson = response.json.bind(response);
      response.json = async () => {
        for (let step = 0; step < 8; step += 1) await Promise.resolve();
        try {
          return await readJson();
        } finally {
          activeRequests -= 1;
        }
      };
      return response;
    });

    const [firstQuotes, secondQuotes] = await Promise.all([
      fetchBrapiQuotes({ apiKey: `concorrencia-${plan}`, plan, tickers: firstTickers, fetcher }),
      fetchAvailableBrapiQuotes({ apiKey: `concorrencia-${plan}`, plan, tickers: secondTickers, fetcher }),
    ]);

    expect(maximumActiveRequests).toBe(concurrency);
    expect(activeRequests).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(concurrency * 2);
    expect(firstQuotes.map((quote) => quote.symbol)).toEqual(firstTickers);
    expect(secondQuotes.map((quote) => quote.symbol)).toEqual(secondTickers);
  });

  it("rejeita localmente um ticker com vírgula em vez de enviar vários símbolos na mesma requisição", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      quoteResponse(new URL(String(input)).searchParams.get("symbols") ?? ""));

    await expect(fetchBrapiQuotes({
      apiKey: "token-individual",
      tickers: ["WEGE3,PETR4"],
      fetcher,
    })).rejects.toMatchObject({ name: "BrapiApiError", status: 400 });

    expect(fetcher).not.toHaveBeenCalled();
    await expect(fetchAvailableBrapiQuotes({
      apiKey: "token-individual",
      tickers: ["WEGE3,PETR4", "ITUB4"],
      fetcher,
    })).resolves.toEqual([expect.objectContaining({ symbol: "ITUB4" })]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("symbols")).toBe("ITUB4");
  });

  it("serializa chamadas concorrentes da mesma chave até terminar de consumir o JSON", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await Promise.resolve();
      const response = quoteResponse(new URL(String(input)).searchParams.get("symbols") ?? "");
      const readJson = response.json.bind(response);
      response.json = async () => {
        await Promise.resolve();
        try {
          return await readJson();
        } finally {
          activeRequests -= 1;
        }
      };
      return response;
    });

    const [firstQuotes, secondQuotes] = await Promise.all([
      fetchBrapiQuotes({ apiKey: "mesma-chave", tickers: ["WEGE3", "ITUB4"], fetcher }),
      fetchAvailableBrapiQuotes({ apiKey: "mesma-chave", tickers: ["PETR4", "VALE3"], fetcher }),
    ]);

    expect(maximumActiveRequests).toBe(1);
    expect(activeRequests).toBe(0);
    expect(firstQuotes.map((quote) => quote.symbol)).toEqual(["WEGE3", "ITUB4"]);
    expect(secondQuotes.map((quote) => quote.symbol)).toEqual(["PETR4", "VALE3"]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [input] of fetcher.mock.calls) {
      expect(new URL(String(input)).searchParams.get("symbols")).not.toContain(",");
    }
  });

  it("permite que chaves diferentes consultem suas cotações independentemente", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await Promise.resolve();
      activeRequests -= 1;
      return quoteResponse(new URL(String(input)).searchParams.get("symbols") ?? "");
    });

    await Promise.all([
      fetchBrapiQuotes({ apiKey: "chave-a", tickers: ["WEGE3"], fetcher }),
      fetchBrapiQuotes({ apiKey: "chave-b", tickers: ["ITUB4"], fetcher }),
    ]);

    expect(maximumActiveRequests).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
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

  it.each([
    { status: 400, tickers: ["INVALID", "WEGE3", "ITUB4"] },
    { status: 404, tickers: ["WEGE3", "INVALID", "ITUB4"] },
  ])("isola ticker inválido com status $status sem repetir consultas válidas", async ({ status, tickers }) => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const symbols = new URL(String(input)).searchParams.get("symbols")?.split(",") ?? [];
      if (symbols.includes("INVALID")) {
        return new Response(JSON.stringify({ error: true, code: "NOT_FOUND" }), {
          status,
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
      tickers,
      fetcher,
    });

    expect(quotes.map((quote) => quote.symbol)).toEqual(["WEGE3", "ITUB4"]);
    expect(vi.mocked(fetcher).mock.calls.map(([input]) => new URL(String(input)).searchParams.get("symbols")))
      .toEqual(tickers);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([400, 404])("a consulta estrita rejeita status %i sem consultar o próximo ticker", async (status) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: true }), { status }));

    await expect(fetchBrapiQuotes({
      apiKey: "token-individual",
      tickers: ["INVALID", "WEGE3"],
      fetcher,
    })).rejects.toMatchObject({ name: "BrapiApiError", status });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([400, 404])("isola um ticker inválido no Startup após status %i sem repetir lotes válidos", async (status) => {
    const tickers = Array.from({ length: 20 }, (_, index) => `TICK${index}`);
    const invalidTicker = tickers[4];
    const successfulSymbols: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const symbols = requestedSymbols(input);
      if (symbols.includes(invalidTicker)) {
        return new Response(JSON.stringify({ error: true }), { status });
      }
      successfulSymbols.push(...symbols);
      return batchQuoteResponse([...symbols].reverse());
    });

    const quotes = await fetchAvailableBrapiQuotes({
      apiKey: `isola-pago-${status}`,
      plan: "STARTUP",
      tickers,
      fetcher,
    });

    const validTickers = tickers.filter((ticker) => ticker !== invalidTicker);
    expect(quotes.map((quote) => quote.symbol)).toEqual(validTickers);
    expect([...successfulSymbols].sort()).toEqual([...validTickers].sort());
    const batches = fetcher.mock.calls.map(([input]) => requestedSymbols(input));
    expect(batches.every((symbols) => symbols.length <= 10)).toBe(true);
    expect(batches).toContainEqual(tickers.slice(10));
    for (const ticker of tickers.slice(10)) {
      expect(batches.flat().filter((symbol) => symbol === ticker)).toHaveLength(1);
    }
  });

  it("interrompe novos lotes após um erro de plano e aguarda os lotes já ativos antes de rejeitar", async () => {
    const tickers = Array.from({ length: 90 }, (_, index) => `TICK${index}`);
    let activeRequests = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const symbols = requestedSymbols(input);
      const blocked = symbols.includes(tickers[0]);
      activeRequests += 1;
      const response = blocked
        ? new Response(JSON.stringify({ error: true }), { status: 403 })
        : batchQuoteResponse(symbols);
      const readJson = response.json.bind(response);
      response.json = async () => {
        for (let step = 0; step < (blocked ? 1 : 8); step += 1) await Promise.resolve();
        try {
          return await readJson();
        } finally {
          activeRequests -= 1;
        }
      };
      return response;
    });

    await expect(fetchAvailableBrapiQuotes({
      apiKey: "erro-plano-pago",
      plan: "STARTUP",
      tickers,
      fetcher,
    })).rejects.toMatchObject({ name: "BrapiApiError", status: 403 });

    expect(activeRequests).toBe(0);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(4);
    expect(fetcher.mock.calls.map(([input]) => requestedSymbols(input)).flat()
      .every((symbol) => tickers.slice(0, 40).includes(symbol))).toBe(true);
  });

  it.each([401, 403, 429, 500])("interrompe as duas consultas no status %i sem retries ou próximos tickers", async (status) => {
    for (const loadQuotes of [fetchBrapiQuotes, fetchAvailableBrapiQuotes]) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: true }), { status }));

      await expect(loadQuotes({
        apiKey: "token-individual",
        tickers: ["WEGE3", "ITUB4", "PETR4"],
        fetcher,
      })).rejects.toMatchObject({ name: "BrapiApiError", status });

      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("libera a fila após uma falha para permitir uma nova consulta com a mesma chave", async () => {
    const failedFetcher = vi.fn(async () => new Response(JSON.stringify({ error: true }), { status: 429 }));
    await expect(fetchBrapiQuotes({ apiKey: "chave-reutilizada", tickers: ["WEGE3"], fetcher: failedFetcher }))
      .rejects.toMatchObject({ status: 429 });
    const successfulFetcher = vi.fn(async () => quoteResponse("ITUB4"));

    await expect(fetchBrapiQuotes({ apiKey: "chave-reutilizada", tickers: ["ITUB4"], fetcher: successfulFetcher }))
      .resolves.toEqual([expect.objectContaining({ symbol: "ITUB4" })]);
    expect(successfulFetcher).toHaveBeenCalledTimes(1);
  });

  it("não consulta os próximos tickers quando o chamador cancela a atualização", async () => {
    for (const loadQuotes of [fetchBrapiQuotes, fetchAvailableBrapiQuotes]) {
      const controller = new AbortController();
      const fetcher = vi.fn(async () => {
        const response = quoteResponse("WEGE3");
        const readJson = response.json.bind(response);
        response.json = async () => {
          const payload = await readJson();
          controller.abort();
          return payload;
        };
        return response;
      });

      await expect(loadQuotes({
        apiKey: "token-individual",
        tickers: ["WEGE3", "ITUB4"],
        fetcher,
        signal: controller.signal,
      })).rejects.toMatchObject({ name: "AbortError" });

      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("não envia uma consulta cancelada enquanto aguardava outra requisição da mesma chave", async () => {
    let notifyStarted!: () => void;
    let releaseResponse!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const released = new Promise<void>((resolve) => { releaseResponse = resolve; });
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      notifyStarted();
      await released;
      return quoteResponse(new URL(String(input)).searchParams.get("symbols") ?? "");
    });
    const first = fetchBrapiQuotes({ apiKey: "fila-cancelada", tickers: ["WEGE3"], fetcher });
    await started;
    const controller = new AbortController();
    const queued = fetchAvailableBrapiQuotes({
      apiKey: "fila-cancelada",
      tickers: ["ITUB4"],
      fetcher,
      signal: controller.signal,
    });
    const queuedRejection = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    releaseResponse();

    await expect(first).resolves.toEqual([expect.objectContaining({ symbol: "WEGE3" })]);
    await queuedRejection;
    expect(fetcher).toHaveBeenCalledTimes(1);
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

  it("isola a chave e o segredo da Binance por usuário e por contexto", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEYS = "v1:" + Buffer.alloc(32, 11).toString("base64url");
    process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY = "v1";
    const keyContext = { userId: "user-binance", type: "binance-api-key" as const };
    const secretContext = { userId: "user-binance", type: "binance-api-secret" as const };
    const encryptedKey = encryptCredential("binance-key", keyContext);
    const encryptedSecret = encryptCredential("binance-secret", secretContext);

    expect(encryptedKey).not.toContain("binance-key");
    expect(encryptedSecret).not.toContain("binance-secret");
    expect(decryptCredential(encryptedKey, keyContext).value).toBe("binance-key");
    expect(decryptCredential(encryptedSecret, secretContext).value).toBe("binance-secret");
    expect(() => decryptCredential(encryptedSecret, keyContext)).toThrow();
    expect(() => decryptCredential(encryptedSecret, { ...secretContext, userId: "other-user" })).toThrow();
  });
});
