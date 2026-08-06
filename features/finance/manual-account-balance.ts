import { Prisma, type FinancialAccountType } from "@prisma/client";

export function accountBalanceDelta(
  type: FinancialAccountType,
  signedTransactionAmount: Prisma.Decimal,
) {
  return type === "CREDIT_CARD"
    ? signedTransactionAmount.negated()
    : signedTransactionAmount;
}

export function balanceTransitionAdjustments({
  previous,
  next,
}: {
  previous?: {
    type: FinancialAccountType;
    amount: Prisma.Decimal;
    applied: boolean;
  };
  next?: {
    type: FinancialAccountType;
    amount: Prisma.Decimal;
    applied: boolean;
  };
}) {
  return {
    reversePrevious: previous?.applied
      ? accountBalanceDelta(previous.type, previous.amount).negated()
      : null,
    applyNext: next?.applied
      ? accountBalanceDelta(next.type, next.amount)
      : null,
  };
}

export async function absorbManualTransactionsIntoBalance(
  tx: Prisma.TransactionClient,
  userId: string,
  accountId: string,
) {
  return tx.financeTransaction.updateMany({
    where: {
      userId,
      accountId,
      source: "MANUAL",
    },
    data: { balanceApplied: false },
  });
}
