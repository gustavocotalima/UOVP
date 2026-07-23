const ACCOUNT_SUBTYPE_LABELS: Record<string, string> = {
  CHECKING: "Conta corrente",
  CHECKING_ACCOUNT: "Conta corrente",
  SAVINGS: "Conta poupança",
  SAVINGS_ACCOUNT: "Conta poupança",
  PAYMENT: "Conta de pagamento",
  PAYMENT_ACCOUNT: "Conta de pagamento",
  DIGITAL: "Conta digital",
  DIGITAL_ACCOUNT: "Conta digital",
  INVESTMENT: "Conta de investimento",
  INVESTMENT_ACCOUNT: "Conta de investimento",
  SALARY: "Conta salário",
  SALARY_ACCOUNT: "Conta salário",
  PREPAID: "Conta pré-paga",
  PREPAID_ACCOUNT: "Conta pré-paga",
  BUSINESS: "Conta empresarial",
  BUSINESS_ACCOUNT: "Conta empresarial",
  CREDIT: "Cartão de crédito",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  PREPAID_CARD: "Cartão pré-pago",
  LINE_OF_CREDIT: "Linha de crédito",
  LOAN: "Empréstimo",
  FINANCING: "Financiamento",
};

export function accountSubtypeLabel(
  subtype: string | null | undefined,
  type: "BANK_ACCOUNT" | "CREDIT_CARD",
) {
  const normalized = subtype?.trim().toUpperCase();
  if (normalized && ACCOUNT_SUBTYPE_LABELS[normalized]) {
    return ACCOUNT_SUBTYPE_LABELS[normalized];
  }
  if (subtype && !subtype.includes("_") && subtype !== subtype.toUpperCase()) {
    return subtype;
  }
  return type === "CREDIT_CARD" ? "Cartão de crédito" : "Conta bancária";
}
