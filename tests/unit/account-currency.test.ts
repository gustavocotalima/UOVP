import { describe, expect, it } from "vitest";
import {
  ACCOUNT_FX_FRESH_MS,
  accountBalanceBrl,
  availableCreditForBalance,
  financialAccountCurrencySymbol,
  isAccountFxFresh,
  sameFinancialDate,
} from "@/features/finance/account-currency";

describe("moedas de contas financeiras", () => {
  it("converte o saldo nativo para BRL sem alterar o valor USD", () => {
    expect(accountBalanceBrl("1000", "5.25").toString()).toBe("5250");
    expect(financialAccountCurrencySymbol("USD")).toBe("US$");
    expect(financialAccountCurrencySymbol("BRL")).toBe("R$");
  });

  it("calcula o limite disponível na moeda nativa do cartão", () => {
    expect(availableCreditForBalance("CREDIT_CARD", "2000", "350")?.toString()).toBe("1650");
    expect(availableCreditForBalance("BANK_ACCOUNT", "2000", "350")).toBeNull();
  });

  it("considera a cotação corrente válida por doze horas", () => {
    const now = new Date("2026-08-03T12:00:00.000Z");
    expect(isAccountFxFresh(new Date(now.getTime() - ACCOUNT_FX_FRESH_MS + 1), now)).toBe(true);
    expect(isAccountFxFresh(new Date(now.getTime() - ACCOUNT_FX_FRESH_MS), now)).toBe(false);
    expect(isAccountFxFresh(null, now)).toBe(false);
  });

  it("identifica a mesma data financeira independentemente do horário", () => {
    expect(sameFinancialDate(
      new Date("2026-08-03T00:00:00.000Z"),
      new Date("2026-08-03T23:59:59.000Z"),
    )).toBe(true);
    expect(sameFinancialDate(
      new Date("2026-08-02T23:59:59.000Z"),
      new Date("2026-08-03T00:00:00.000Z"),
    )).toBe(false);
  });
});
