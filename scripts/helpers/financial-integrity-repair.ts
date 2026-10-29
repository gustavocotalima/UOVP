import { Prisma, type FinancialFxSource } from "@/generated/prisma/client";

export type FinancialIntegrityRepairOptions = {
  apply: boolean;
  userId: string | undefined;
  batchSize: number;
};

export function parseFinancialIntegrityRepairOptions(args: string[]): FinancialIntegrityRepairOptions {
  let apply = false;
  let userId: string | undefined;
  let batchSize = 100;
  const seen = new Set<string>();
  for (const arg of args) {
    const key = arg.split("=", 1)[0];
    if (seen.has(key)) throw new Error("Argumento repetido.");
    seen.add(key);
    if (arg === "--apply") apply = true;
    else if (/^--user-id=[A-Za-z0-9_-]{1,128}$/.test(arg)) userId = arg.slice("--user-id=".length);
    else if (/^--batch-size=\d+$/.test(arg)) {
      batchSize = Number(arg.slice("--batch-size=".length));
      if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
        throw new Error("--batch-size deve estar entre 1 e 500.");
      }
    } else throw new Error("Use apenas --apply, --user-id=ID e --batch-size=1..500.");
  }
  return { apply, userId, batchSize };
}

export type ReportingRepairInput = {
  amount: Prisma.Decimal;
  currencyCode: string;
  reportingAmountBrl: Prisma.Decimal | null;
  fxRateToBrl: Prisma.Decimal | null;
  fxSource: FinancialFxSource | null;
};

export type ReportingRepairPlan =
  | { status: "UNCHANGED" }
  | { status: "REPAIRABLE_NATIVE_BRL"; expected: Prisma.Decimal }
  | { status: "REVIEW_REQUIRED"; reason: "MISSING_OR_INVALID_RATE" | "UNVERIFIED_RATE_CURRENCY" };

/**
 * Old imported transactions do not record the currency/date basis of their FX
 * snapshot. A non-BRL amount * stored rate is useful diagnostic evidence, but is
 * insufficient proof that the rate still belongs to that amount's currency.
 * Only a BRL/NATIVE/1 snapshot is repaired without querying provider history.
 */
export function planReportingAmountRepair(input: ReportingRepairInput): ReportingRepairPlan {
  const rate = input.fxRateToBrl;
  if (!input.amount.isFinite() || !rate?.isFinite() || !rate.gt(0)) {
    return { status: "REVIEW_REQUIRED", reason: "MISSING_OR_INVALID_RATE" };
  }
  const expected = input.amount.mul(rate).toDecimalPlaces(2);
  if (input.reportingAmountBrl?.isFinite() && input.reportingAmountBrl.eq(expected)) {
    return { status: "UNCHANGED" };
  }
  if (input.currencyCode === "BRL" && input.fxSource === "NATIVE" && rate.eq(1)) {
    return { status: "REPAIRABLE_NATIVE_BRL", expected };
  }
  return { status: "REVIEW_REQUIRED", reason: "UNVERIFIED_RATE_CURRENCY" };
}
