import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  accountBalanceDelta,
  balanceTransitionAdjustments,
} from "@/features/finance/manual-account-balance";

describe("saldo de contas manuais", () => {
  it("parte do saldo corrigido e chega a US$ 548,15 com as novas transações", () => {
    let balance = new Prisma.Decimal("68.38");
    for (const amount of ["490.00", "-2.50", "-7.73"]) {
      balance = balance.add(accountBalanceDelta("BANK_ACCOUNT", new Prisma.Decimal(amount)));
    }
    expect(balance.toFixed(2)).toBe("548.15");
  });

  it.each([
    { previous: true, next: true, reverse: "100.00", apply: "-75.00" },
    { previous: true, next: false, reverse: "100.00", apply: null },
    { previous: false, next: true, reverse: null, apply: "-75.00" },
    { previous: false, next: false, reverse: null, apply: null },
  ])("calcula a transição applied=$previous → $next", ({ previous, next, reverse, apply }) => {
    const result = balanceTransitionAdjustments({
      previous: {
        type: "BANK_ACCOUNT",
        amount: new Prisma.Decimal("-100.00"),
        applied: previous,
      },
      next: {
        type: "BANK_ACCOUNT",
        amount: new Prisma.Decimal("-75.00"),
        applied: next,
      },
    });
    expect(result.reversePrevious?.toFixed(2) ?? null).toBe(reverse);
    expect(result.applyNext?.toFixed(2) ?? null).toBe(apply);
  });

  it("inverte o efeito em cartões", () => {
    expect(accountBalanceDelta("CREDIT_CARD", new Prisma.Decimal("-120.00")).toFixed(2))
      .toBe("120.00");
    expect(accountBalanceDelta("CREDIT_CARD", new Prisma.Decimal("40.00")).toFixed(2))
      .toBe("-40.00");
  });

  it("reverte a conta anterior e aplica na nova ao mover a transação", () => {
    const result = balanceTransitionAdjustments({
      previous: {
        type: "BANK_ACCOUNT",
        amount: new Prisma.Decimal("-100.00"),
        applied: true,
      },
      next: {
        type: "CREDIT_CARD",
        amount: new Prisma.Decimal("-100.00"),
        applied: true,
      },
    });
    expect(result.reversePrevious?.toFixed(2)).toBe("100.00");
    expect(result.applyNext?.toFixed(2)).toBe("100.00");
  });
});
