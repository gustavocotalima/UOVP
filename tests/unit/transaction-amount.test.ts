import { describe, expect, it } from "vitest";
import { resolvePluggyTransactionAmounts } from "@/features/open-finance/transaction-amount";

describe("normalização monetária de transações Pluggy", () => {
  it("usa o valor convertido para a moeda da conta e preserva guaranis", () => {
    expect(resolvePluggyTransactionAmounts({
      amount: 658_600,
      amountInAccountCurrency: 561.11,
      kind: "EXPENSE",
    })).toEqual({
      amount: "-561.11",
      originalAmount: "-658600",
    });
  });

  it("usa o valor convertido para compras em dólar", () => {
    expect(resolvePluggyTransactionAmounts({
      amount: 101.78,
      amountInAccountCurrency: 525,
      kind: "EXPENSE",
    })).toEqual({
      amount: "-525",
      originalAmount: "-101.78",
    });
  });

  it("mantém o valor original quando não há conversão informada", () => {
    expect(resolvePluggyTransactionAmounts({
      amount: -150,
      amountInAccountCurrency: null,
      kind: "INCOME",
    })).toEqual({
      amount: "150",
      originalAmount: "150",
    });
  });
});
