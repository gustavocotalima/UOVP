import { Prisma } from "@/generated/prisma/client";

export type ContributionBaseline = {
  holdingId: string; quantity: Prisma.Decimal; providerValue: Prisma.Decimal | null;
  currency: string; fxRateToBrl: Prisma.Decimal | null; providerLatestTransactionAt: Date | null;
};

export function contributionBaselines(value: Prisma.JsonValue): ContributionBaseline[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = entry as Record<string, string | null>;
    return {
      holdingId: row.holdingId!, quantity: new Prisma.Decimal(row.quantity!),
      providerValue: row.providerValue == null ? null : new Prisma.Decimal(row.providerValue),
      currency: row.currency!, fxRateToBrl: row.fxRateToBrl == null ? null : new Prisma.Decimal(row.fxRateToBrl),
      providerLatestTransactionAt: row.providerLatestTransactionAt ? new Date(row.providerLatestTransactionAt) : null,
    };
  });
}

export function serializeContributionBaselines(rows: ContributionBaseline[]): Prisma.InputJsonValue {
  return rows.map((row) => ({
    ...row, quantity: row.quantity.toString(), providerValue: row.providerValue?.toString() ?? null,
    fxRateToBrl: row.fxRateToBrl?.toString() ?? null,
    providerLatestTransactionAt: row.providerLatestTransactionAt?.toISOString() ?? null,
  }));
}
