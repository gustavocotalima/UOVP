import { describe, expect, it } from "vitest";
import { accountSubtypeLabel } from "@/features/finance/account-labels";

describe("account subtype labels", () => {
  it("translates Pluggy checking and savings account labels", () => {
    expect(accountSubtypeLabel("CHECKING_ACCOUNT", "BANK_ACCOUNT")).toBe("Conta corrente");
    expect(accountSubtypeLabel("SAVINGS_ACCOUNT", "BANK_ACCOUNT")).toBe("Conta poupança");
  });

  it("translates payment, investment and credit labels", () => {
    expect(accountSubtypeLabel("PAYMENT_ACCOUNT", "BANK_ACCOUNT")).toBe("Conta de pagamento");
    expect(accountSubtypeLabel("INVESTMENT_ACCOUNT", "BANK_ACCOUNT")).toBe("Conta de investimento");
    expect(accountSubtypeLabel("CREDIT_CARD", "CREDIT_CARD")).toBe("Cartão de crédito");
  });

  it("does not expose unknown provider enum values", () => {
    expect(accountSubtypeLabel("NEW_PROVIDER_ENUM", "BANK_ACCOUNT")).toBe("Conta bancária");
    expect(accountSubtypeLabel(null, "CREDIT_CARD")).toBe("Cartão de crédito");
  });
});
