export const BRAPI_PLANS = ["FREE", "STARTUP", "PRO"] as const;

export type BrapiPlan = typeof BRAPI_PLANS[number];

// https://brapi.dev/faq/quais-as-limitacoes
export const BRAPI_PLAN_LIMITS = {
  FREE: { label: "Gratuito", symbolsPerRequest: 1, concurrentRequests: 1 },
  STARTUP: { label: "Startup", symbolsPerRequest: 10, concurrentRequests: 4 },
  PRO: { label: "Pro", symbolsPerRequest: 20, concurrentRequests: 16 },
} as const satisfies Record<BrapiPlan, { label: string; symbolsPerRequest: number; concurrentRequests: number }>;

export function normalizeBrapiPlan(value: unknown): BrapiPlan {
  return BRAPI_PLANS.find((plan) => plan === value) ?? "FREE";
}
