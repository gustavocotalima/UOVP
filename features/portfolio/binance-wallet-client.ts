import { createHmac } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { withProviderRequestDeadline } from "@/lib/provider-request-budget";

const BINANCE_API_URL = "https://api.binance.com";
const RECEIVE_WINDOW_MS = 5_000;
const BINANCE_REQUEST_TIMEOUT_MS = 10_000;
const BINANCE_PERMISSIONS_TIMEOUT_MS = 30_000;
const BINANCE_WALLET_TIMEOUT_MS = 120_000;
const BINANCE_MAX_REQUESTS = 220;

type BinanceRequestContext = { signal: AbortSignal; remainingRequests: number };
type BinancePrivateClientOptions = {
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  operationTimeoutMs?: number;
  maxRequests?: number;
};

export type BinanceWalletKind = "SPOT" | "FUNDING" | "EARN_FLEXIBLE" | "EARN_LOCKED";

export type BinancePrivateCredentials = {
  apiKey: string;
  apiSecret: string;
};

export type BinanceWalletBalance = {
  symbol: string;
  name: string | null;
  quantity: string;
  btcValuation: string | null;
};

export type BinanceWalletBucketResult = {
  kind: BinanceWalletKind;
  ok: boolean;
  balances: BinanceWalletBalance[];
  error: string | null;
};

export type BinanceApiPermissions = {
  ipRestricted: boolean;
  readEnabled: boolean;
  tradingEnabled: boolean;
  withdrawalsEnabled: boolean;
  warning: boolean;
};

export type BinanceWalletSnapshot = {
  buckets: BinanceWalletBucketResult[];
  totalBtcValuations: Record<string, string>;
  valuationsComplete: boolean;
};

const errorSchema = z.object({
  code: z.number().optional(),
  msg: z.string().optional(),
}).passthrough();

const permissionsSchema = z.object({
  ipRestrict: z.boolean().default(false),
  enableReading: z.boolean().default(false),
  enableWithdrawals: z.boolean().default(false),
  enableSpotAndMarginTrading: z.boolean().default(false),
  enableMargin: z.boolean().default(false),
  enableFutures: z.boolean().default(false),
  enableVanillaOptions: z.boolean().default(false),
  enablePortfolioMarginTrading: z.boolean().default(false),
  enableFixApiTrade: z.boolean().default(false),
}).passthrough();

const assetBalanceSchema = z.object({
  asset: z.string(),
  assetName: z.string().optional(),
  free: z.string().default("0"),
  locked: z.string().default("0"),
  freeze: z.string().default("0"),
  withdrawing: z.string().default("0"),
  btcValuation: z.string().optional(),
}).passthrough();

const walletSchema = z.array(z.object({
  walletName: z.string(),
  assetBalances: z.array(assetBalanceSchema).optional().default([]),
}).passthrough());

const spotAccountSchema = z.object({
  balances: z.array(assetBalanceSchema.pick({ asset: true, free: true, locked: true })),
}).passthrough();

const earnPageSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).default([]),
  total: z.number().or(z.string().transform(Number)).default(0),
}).passthrough();

export class BinancePrivateApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "BinancePrivateApiError";
  }
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function decimalSum(values: Array<string | undefined>) {
  return values.reduce(
    (total, value) => {
      try {
        return total.add(value ?? 0);
      } catch {
        return total;
      }
    },
    new Decimal(0),
  ).toString();
}

function sanitizeBinanceError(status: number, code?: number, retryAfterSeconds?: number) {
  if (code === -2014 || code === -2015 || status === 401) {
    return "A Binance recusou a chave ou o endereço IP deste servidor.";
  }
  if (code === -1021) return "O relógio do servidor não pôde ser sincronizado com a Binance.";
  if (status === 451) return "A Binance bloqueou o acesso a partir da região ou do IP deste servidor. Use um servidor em uma região aceita pela Binance.";
  if (status === 418) return "A Binance bloqueou temporariamente este servidor por excesso de requisições.";
  if (status === 429) {
    return `O limite de requisições da Binance foi atingido${retryAfterSeconds ? `. Tente novamente em ${retryAfterSeconds} segundo(s)` : ""}.`;
  }
  if (status >= 500) return "A Binance está temporariamente indisponível.";
  return "Não foi possível consultar a carteira da Binance.";
}

function percentEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function encodeBinanceSignedParameters(parameters: Record<string, string | number | boolean>) {
  return Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${percentEncode(key)}=${percentEncode(String(value))}`)
    .join("&");
}

export class BinancePrivateClient {
  private clockOffsetMs = 0;
  private clockRequest: Promise<void> | null = null;
  private clockSynchronizedAt = 0;

  constructor(
    private readonly credentials: BinancePrivateCredentials,
    private readonly fetcher: typeof fetch = fetch,
    private readonly options: BinancePrivateClientOptions = {},
  ) {}

  private runOperation<T>(timeoutMs: number, operation: (context: BinanceRequestContext) => Promise<T>) {
    return withProviderRequestDeadline({
      signal: this.options.signal,
      timeoutMs: this.options.operationTimeoutMs ?? timeoutMs,
      timeoutError: new BinancePrivateApiError("O prazo total de consulta à Binance foi atingido. Tente novamente.", 504),
    }, (signal) => operation({ signal, remainingRequests: this.options.maxRequests ?? BINANCE_MAX_REQUESTS }));
  }

  private async requestJson(url: string, init: RequestInit, context: BinanceRequestContext) {
    context.signal.throwIfAborted();
    if (context.remainingRequests <= 0) {
      throw new BinancePrivateApiError("O limite de consultas da carteira Binance foi atingido. Tente novamente.", 502);
    }
    context.remainingRequests -= 1;
    return withProviderRequestDeadline({
      signal: context.signal,
      timeoutMs: this.options.requestTimeoutMs ?? BINANCE_REQUEST_TIMEOUT_MS,
      timeoutError: new BinancePrivateApiError("A Binance demorou demais para responder. Tente novamente.", 504),
    }, async (signal) => {
      const response = await this.fetcher(url, { ...init, signal });
      const payload: unknown = await response.json().catch(() => {
        signal.throwIfAborted();
        return null;
      });
      signal.throwIfAborted();
      return { response, payload };
    });
  }

  private async synchronizeClock(context: BinanceRequestContext, force = false) {
    if (!force && this.clockSynchronizedAt && Date.now() - this.clockSynchronizedAt < 60_000) return;
    if (this.clockRequest && !force) return this.clockRequest;
    const pending = (async () => {
      const startedAt = Date.now();
      const { response, payload } = await this.requestJson(`${BINANCE_API_URL}/api/v3/time`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }, context);
      const parsed = z.object({ serverTime: z.number() }).safeParse(payload);
      if (!response.ok || !parsed.success) {
        throw new BinancePrivateApiError("Não foi possível sincronizar o relógio com a Binance.", response.status);
      }
      const midpoint = startedAt + Math.floor((Date.now() - startedAt) / 2);
      this.clockOffsetMs = parsed.data.serverTime - midpoint;
      this.clockSynchronizedAt = Date.now();
    })().finally(() => {
      this.clockRequest = null;
    });
    this.clockRequest = pending;
    return pending;
  }

  private async signedRequest<T>({
    method,
    path,
    parameters = {},
    schema,
    retryClock = true,
    context,
  }: {
    method: "GET" | "POST";
    path: string;
    parameters?: Record<string, string | number | boolean>;
    schema: z.ZodType<T>;
    retryClock?: boolean;
    context: BinanceRequestContext;
  }): Promise<T> {
    await this.synchronizeClock(context).catch((error) => {
      context.signal.throwIfAborted();
      if (error instanceof BinancePrivateApiError && error.status === 504) throw error;
    });
    context.signal.throwIfAborted();
    const requestParameters = encodeBinanceSignedParameters({
      ...parameters,
      recvWindow: RECEIVE_WINDOW_MS,
      timestamp: Date.now() + this.clockOffsetMs,
    });
    const signature = createHmac("sha256", this.credentials.apiSecret)
      .update(requestParameters)
      .digest("hex");
    const signedPayload = `${requestParameters}&signature=${signature}`;
    const url = method === "GET" ? `${BINANCE_API_URL}${path}?${signedPayload}` : `${BINANCE_API_URL}${path}`;
    const { response, payload } = await this.requestJson(url, {
      method,
      headers: {
        Accept: "application/json",
        "X-MBX-APIKEY": this.credentials.apiKey,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: method === "POST" ? signedPayload : undefined,
      cache: "no-store",
    }, context);
    if (!response.ok) {
      const parsedError = errorSchema.safeParse(payload);
      const code = parsedError.success ? parsedError.data.code : undefined;
      if (code === -1021 && retryClock) {
        await this.synchronizeClock(context, true);
        return this.signedRequest({ method, path, parameters, schema, retryClock: false, context });
      }
      const retryAfter = Number(response.headers.get("retry-after") ?? 0) || undefined;
      throw new BinancePrivateApiError(
        sanitizeBinanceError(response.status, code, retryAfter),
        response.status,
        code,
        retryAfter,
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new BinancePrivateApiError("A Binance retornou uma resposta de carteira inválida.", 502);
    }
    return parsed.data;
  }

  async permissions(): Promise<BinanceApiPermissions> {
    return this.runOperation(BINANCE_PERMISSIONS_TIMEOUT_MS, (context) => this.readPermissions(context));
  }

  private async readPermissions(context: BinanceRequestContext): Promise<BinanceApiPermissions> {
    const result = await this.signedRequest({
      method: "GET",
      path: "/sapi/v1/account/apiRestrictions",
      schema: permissionsSchema,
      context,
    });
    const tradingEnabled = result.enableSpotAndMarginTrading
      || result.enableMargin
      || result.enableFutures
      || result.enableVanillaOptions
      || result.enablePortfolioMarginTrading
      || result.enableFixApiTrade;
    const warning = tradingEnabled || result.enableWithdrawals;
    return {
      ipRestricted: result.ipRestrict,
      readEnabled: result.enableReading,
      tradingEnabled,
      withdrawalsEnabled: result.enableWithdrawals,
      warning,
    };
  }

  private walletRowsToBalances(rows: z.infer<typeof assetBalanceSchema>[]) {
    return rows.flatMap<BinanceWalletBalance>((row) => {
      const symbol = normalizeSymbol(row.asset);
      const quantity = decimalSum([row.free, row.locked, row.freeze, row.withdrawing]);
      if (!symbol || Number(quantity) <= 0) return [];
      return [{
        symbol,
        name: row.assetName?.trim() || null,
        quantity,
        btcValuation: row.btcValuation ?? null,
      }];
    });
  }

  private async consolidatedSpotAndFunding(context: BinanceRequestContext): Promise<{
    buckets: BinanceWalletBucketResult[];
    totalBtcValuations: Record<string, string>;
  }> {
    const wallets = await this.signedRequest({
      method: "GET",
      path: "/sapi/v1/asset/wallet/balance",
      parameters: { quoteAsset: "BTC", needBalanceDetail: true },
      schema: walletSchema,
      context,
    });
    const findRows = (pattern: RegExp) => wallets
      .filter((wallet) => pattern.test(wallet.walletName))
      .flatMap((wallet) => wallet.assetBalances);
    const totalBtcValuations: Record<string, string> = {};
    for (const row of wallets.flatMap((wallet) => wallet.assetBalances)) {
      const symbol = normalizeSymbol(row.asset);
      if (!symbol || !row.btcValuation) continue;
      try {
        const value = new Decimal(row.btcValuation);
        if (!value.isFinite() || value.lt(0)) continue;
        totalBtcValuations[symbol] = new Decimal(totalBtcValuations[symbol] ?? 0).add(value).toString();
      } catch {
        continue;
      }
    }
    return {
      buckets: [
        { kind: "SPOT", ok: true, balances: this.walletRowsToBalances(findRows(/spot/i)), error: null },
        { kind: "FUNDING", ok: true, balances: this.walletRowsToBalances(findRows(/funding/i)), error: null },
      ],
      totalBtcValuations,
    };
  }

  private async fallbackSpot(context: BinanceRequestContext): Promise<BinanceWalletBucketResult> {
    const account = await this.signedRequest({
      method: "GET",
      path: "/api/v3/account",
      parameters: { omitZeroBalances: true },
      schema: spotAccountSchema,
      context,
    });
    return {
      kind: "SPOT",
      ok: true,
      balances: this.walletRowsToBalances(account.balances.map((balance) => ({ ...balance, freeze: "0", withdrawing: "0" }))),
      error: null,
    };
  }

  private async fallbackFunding(context: BinanceRequestContext): Promise<BinanceWalletBucketResult> {
    const balances = await this.signedRequest({
      method: "POST",
      path: "/sapi/v1/asset/get-funding-asset",
      parameters: { needBtcValuation: true },
      schema: z.array(assetBalanceSchema),
      context,
    });
    return { kind: "FUNDING", ok: true, balances: this.walletRowsToBalances(balances), error: null };
  }

  private async earnPositions(
    kind: "EARN_FLEXIBLE" | "EARN_LOCKED",
    path: string,
    context: BinanceRequestContext,
  ): Promise<BinanceWalletBucketResult> {
    const totals = new Map<string, BinanceWalletBalance>();
    let current = 1;
    while (current <= 100) {
      context.signal.throwIfAborted();
      const page = await this.signedRequest({
        method: "GET",
        path,
        parameters: { current, size: 100 },
        schema: earnPageSchema,
        context,
      });
      for (const row of page.rows) {
        const symbol = normalizeSymbol(String(row.asset ?? ""));
        const rawQuantity = row.totalAmount ?? row.amount ?? row.totalSubscriptionAmount ?? row.holdingAmount ?? "0";
        let quantity: Decimal;
        try {
          quantity = new Decimal(String(rawQuantity));
        } catch {
          continue;
        }
        if (!symbol || !quantity.isFinite() || quantity.lte(0)) continue;
        const previous = totals.get(symbol);
        totals.set(symbol, {
          symbol,
          name: null,
          quantity: new Decimal(previous?.quantity ?? 0).add(quantity).toString(),
          btcValuation: null,
        });
      }
      if (current * 100 >= page.total || page.rows.length < 100) break;
      if (current === 100) {
        throw new BinancePrivateApiError("O Simple Earn excedeu o limite de páginas da consulta. Os dados anteriores foram preservados.", 502);
      }
      current += 1;
    }
    return { kind, ok: true, balances: [...totals.values()], error: null };
  }

  async walletSnapshot(): Promise<BinanceWalletSnapshot> {
    return this.runOperation(BINANCE_WALLET_TIMEOUT_MS, (context) => this.readWalletSnapshot(context));
  }

  private async readWalletSnapshot(context: BinanceRequestContext): Promise<BinanceWalletSnapshot> {
    let spotAndFunding: BinanceWalletBucketResult[];
    let totalBtcValuations: Record<string, string> = {};
    let valuationsComplete = false;
    try {
      const consolidated = await this.consolidatedSpotAndFunding(context);
      spotAndFunding = consolidated.buckets;
      totalBtcValuations = consolidated.totalBtcValuations;
      valuationsComplete = true;
    } catch {
      context.signal.throwIfAborted();
      const fallback = await Promise.allSettled([this.fallbackSpot(context), this.fallbackFunding(context)]);
      context.signal.throwIfAborted();
      spotAndFunding = fallback.map((result, index) => result.status === "fulfilled"
        ? result.value
        : {
            kind: (index === 0 ? "SPOT" : "FUNDING") as BinanceWalletKind,
            ok: false,
            balances: [],
            error: result.reason instanceof Error ? result.reason.message : "Não foi possível consultar esta carteira.",
          });
    }
    const earn = await Promise.allSettled([
      this.earnPositions("EARN_FLEXIBLE", "/sapi/v1/simple-earn/flexible/position", context),
      this.earnPositions("EARN_LOCKED", "/sapi/v1/simple-earn/locked/position", context),
    ]);
    context.signal.throwIfAborted();
    const earnResults = earn.map((result, index) => result.status === "fulfilled"
      ? result.value
      : {
          kind: (index === 0 ? "EARN_FLEXIBLE" : "EARN_LOCKED") as BinanceWalletKind,
          ok: false,
          balances: [],
          error: result.reason instanceof Error ? result.reason.message : "Não foi possível consultar o Simple Earn.",
        });
    const buckets = [...spotAndFunding, ...earnResults];
    if (!buckets.some((bucket) => bucket.ok)) {
      throw new BinancePrivateApiError("Nenhuma carteira da Binance pôde ser consultada.", 502);
    }
    return { buckets, totalBtcValuations, valuationsComplete };
  }
}
