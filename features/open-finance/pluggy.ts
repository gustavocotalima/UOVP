import { createHash } from "node:crypto";
import { z } from "zod";
import type { PluggyCredentials } from "./pluggy-credentials";

const PLUGGY_API_URL = "https://api.pluggy.ai";
const API_KEY_LIFETIME_MS = 110 * 60 * 1_000;
const MAX_TRANSACTION_PAGES = 100;
const MAX_INVESTMENT_TRANSACTION_PAGES = 100;

const nullableString = z.string().nullable().optional();
const nullableNumber = z.union([z.number(), z.string()]).nullable().optional();

const connectorSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    imageUrl: nullableString,
    primaryColor: nullableString,
  })
  .passthrough();

export const pluggyItemSchema = z
  .object({
    id: z.string().uuid(),
    clientUserId: nullableString,
    status: z.string(),
    executionStatus: nullableString,
    lastUpdatedAt: nullableString,
    updatedAt: nullableString,
    consentExpiresAt: nullableString,
    connector: connectorSchema,
    error: z
      .object({
        code: nullableString,
        message: nullableString,
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const accountSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string(),
    subtype: nullableString,
    name: z.string(),
    marketingName: nullableString,
    number: nullableString,
    balance: nullableNumber,
    currencyCode: nullableString,
    bankData: z
      .object({
        transferNumber: nullableString,
      })
      .passthrough()
      .nullable()
      .optional(),
    creditData: z
      .object({
        level: nullableString,
        brand: nullableString,
        balanceCloseDate: nullableString,
        balanceDueDate: nullableString,
        availableCreditLimit: nullableNumber,
        creditLimit: nullableNumber,
      })
      .passthrough()
      .nullable()
      .optional(),
    createdAt: nullableString,
    updatedAt: nullableString,
  })
  .passthrough();

const transactionSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    description: z.string(),
    descriptionRaw: nullableString,
    amount: nullableNumber,
    amountInAccountCurrency: nullableNumber,
    balance: nullableNumber,
    currencyCode: nullableString,
    date: z.string(),
    type: nullableString,
    status: nullableString,
    category: nullableString,
    categoryId: nullableString,
    operationType: nullableString,
    merchant: z
      .object({
        name: nullableString,
        businessName: nullableString,
        cnpj: nullableString,
        cnae: nullableString,
        category: nullableString,
      })
      .passthrough()
      .nullable()
      .optional(),
    paymentData: z
      .object({
        paymentMethod: nullableString,
        payer: z
          .object({ name: nullableString })
          .passthrough()
          .nullable()
          .optional(),
        receiver: z
          .object({ name: nullableString })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    creditCardMetadata: z
      .object({
        installmentNumber: z.number().int().positive().nullable().optional(),
        totalInstallments: z.number().int().positive().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    createdAt: nullableString,
    updatedAt: nullableString,
  })
  .passthrough();

const investmentSchema = z
  .object({
    id: z.string().uuid(),
    itemId: z.string().uuid(),
    name: z.string(),
    code: nullableString,
    isin: nullableString,
    type: z.string(),
    subtype: nullableString,
    balance: nullableNumber,
    value: nullableNumber,
    quantity: nullableNumber,
    amount: nullableNumber,
    taxes: nullableNumber,
    taxes2: nullableNumber,
    date: nullableString,
    owner: nullableString,
    number: nullableString,
    amountProfit: nullableNumber,
    amountWithdrawal: nullableNumber,
    amountOriginal: nullableNumber,
    lastMonthRate: nullableNumber,
    annualRate: nullableNumber,
    lastTwelveMonthsRate: nullableNumber,
    currencyCode: nullableString,
    institution: z
      .union([
        z.string(),
        z
          .object({
            name: nullableString,
            number: nullableString,
            insurer: z
              .object({
                name: nullableString,
                cnpj: nullableString,
              })
              .passthrough()
              .nullable()
              .optional(),
          })
          .passthrough(),
      ])
      .nullable()
      .optional(),
    issuer: nullableString,
    issuerCNPJ: nullableString,
    rate: nullableNumber,
    rateType: nullableString,
    fixedAnnualRate: nullableNumber,
    purchaseDate: nullableString,
    dueDate: nullableString,
    issueDate: nullableString,
    gracePeriodDate: nullableString,
    metadata: z.unknown().nullable().optional(),
    status: nullableString,
    createdAt: nullableString,
    updatedAt: nullableString,
  })
  .passthrough();

const investmentTransactionSchema = z
  .object({
    id: z.string().min(1),
    description: nullableString,
    type: z.string(),
    movementType: nullableString,
    quantity: nullableNumber,
    value: nullableNumber,
    amount: nullableNumber,
    netAmount: nullableNumber,
    agreedRate: nullableNumber,
    brokerageNumber: nullableString,
    date: z.string(),
    tradeDate: nullableString,
    expenses: z.unknown().nullable().optional(),
  })
  .passthrough();

const apiErrorSchema = z
  .object({
    code: z.union([z.string(), z.number()]).optional(),
    codeDescription: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export type PluggyItemResponse = z.infer<typeof pluggyItemSchema>;
export type PluggyAccountResponse = z.infer<typeof accountSchema>;
export type PluggyTransactionResponse = z.infer<typeof transactionSchema>;
export type PluggyInvestmentResponse = z.infer<typeof investmentSchema>;
export type PluggyInvestmentTransactionResponse = z.infer<typeof investmentTransactionSchema>;

export class PluggyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PluggyApiError";
  }
}

const apiKeyCache = new Map<string, { value: string; expiresAt: number }>();

function credentialFingerprint(credentials: PluggyCredentials) {
  return createHash("sha256")
    .update(credentials.clientId)
    .update("\0")
    .update(credentials.clientSecret)
    .digest("base64url");
}

async function getApiKey(credentials: PluggyCredentials, forceRefresh = false) {
  const fingerprint = credentialFingerprint(credentials);
  for (const [key, entry] of apiKeyCache) {
    if (entry.expiresAt <= Date.now()) apiKeyCache.delete(key);
  }
  if (forceRefresh) apiKeyCache.delete(fingerprint);
  const cached = apiKeyCache.get(fingerprint);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await fetch(`${PLUGGY_API_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
    cache: "no-store",
  });
  const data: unknown = await response.json().catch(() => null);
  const parsed = z.object({ apiKey: z.string().min(1) }).safeParse(data);
  if (!response.ok || !parsed.success) {
    throw new PluggyApiError("Não foi possível autenticar com a Pluggy.", response.status);
  }
  apiKeyCache.set(fingerprint, {
    value: parsed.data.apiKey,
    expiresAt: Date.now() + API_KEY_LIFETIME_MS,
  });
  if (apiKeyCache.size > 500) {
    const oldestKey = apiKeyCache.keys().next().value;
    if (oldestKey) apiKeyCache.delete(oldestKey);
  }
  return parsed.data.apiKey;
}

async function pluggyRequest<T>(
  credentials: PluggyCredentials,
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  retryAuthentication = true,
): Promise<T> {
  const apiKey = await getApiKey(credentials);
  const response = await fetch(`${PLUGGY_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
      "X-API-KEY": apiKey,
    },
    cache: "no-store",
  });
  if (response.status === 401 && retryAuthentication) {
    apiKeyCache.delete(credentialFingerprint(credentials));
    await getApiKey(credentials, true);
    return pluggyRequest(credentials, path, schema, init, false);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(data);
    const code = error.success ? String(error.data.codeDescription ?? error.data.code ?? "") || undefined : undefined;
    const message = error.success && error.data.message ? error.data.message : "A Pluggy não concluiu a solicitação.";
    throw new PluggyApiError(message, response.status, code);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new PluggyApiError("A Pluggy retornou dados em um formato inesperado.", 502);
  return parsed.data;
}

export async function validatePluggyCredentials(credentials: PluggyCredentials) {
  await getApiKey(credentials, true);
}

export async function getPluggyItem(credentials: PluggyCredentials, itemId: string) {
  return pluggyRequest(credentials, `/items/${encodeURIComponent(itemId)}`, pluggyItemSchema);
}

export async function createPluggyConnectToken(
  credentials: PluggyCredentials,
  userId: string,
  itemId?: string,
) {
  return pluggyRequest(
    credentials,
    "/connect_token",
    z.object({ accessToken: z.string().min(1) }).passthrough(),
    {
      method: "POST",
      body: JSON.stringify({
        ...(itemId ? { itemId } : {}),
        options: {
          clientUserId: userId,
          avoidDuplicates: true,
        },
      }),
    },
  );
}

export async function getPluggyAccounts(credentials: PluggyCredentials, itemId: string) {
  const data = await pluggyRequest(
    credentials,
    `/accounts?itemId=${encodeURIComponent(itemId)}`,
    z.object({ results: z.array(accountSchema) }).passthrough(),
  );
  return data.results;
}

export async function getPluggyInvestments(credentials: PluggyCredentials, itemId: string) {
  const results: PluggyInvestmentResponse[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await pluggyRequest(
      credentials,
      `/investments?itemId=${encodeURIComponent(itemId)}&pageSize=500&page=${page}`,
      z.object({ results: z.array(investmentSchema), totalPages: z.number().int().nonnegative() }).passthrough(),
    );
    results.push(...data.results);
    totalPages = data.totalPages;
    page += 1;
  } while (page <= totalPages);
  return results;
}

export async function getPluggyInvestmentTransactions(
  credentials: PluggyCredentials,
  investmentId: string,
) {
  const results: PluggyInvestmentTransactionResponse[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await pluggyRequest(
      credentials,
      `/investments/${encodeURIComponent(investmentId)}/transactions?pageSize=500&page=${page}`,
      z
        .object({
          results: z.array(investmentTransactionSchema),
          totalPages: z.number().int().nonnegative(),
        })
        .passthrough(),
    );
    results.push(...data.results);
    totalPages = data.totalPages;
    page += 1;
  } while (page <= totalPages && page <= MAX_INVESTMENT_TRANSACTION_PAGES);
  if (page <= totalPages) {
    throw new PluggyApiError("O investimento excedeu o limite seguro de paginação da sincronização.", 422);
  }
  return results;
}

export async function getPluggyTransactions(credentials: PluggyCredentials, accountId: string) {
  const results: PluggyTransactionResponse[] = [];
  let nextQuery: string | null = `?accountId=${encodeURIComponent(accountId)}`;
  let pageCount = 0;
  do {
    const data: { results: PluggyTransactionResponse[]; next?: string | null } = await pluggyRequest(
      credentials,
      `/v2/transactions${nextQuery}`,
      z.object({ results: z.array(transactionSchema), next: z.string().nullable().optional() }).passthrough(),
    );
    results.push(...data.results);
    nextQuery = data.next ?? null;
    pageCount += 1;
  } while (nextQuery && pageCount < MAX_TRANSACTION_PAGES);
  if (nextQuery) throw new PluggyApiError("A conta excedeu o limite seguro de paginação da sincronização.", 422);
  return results;
}
