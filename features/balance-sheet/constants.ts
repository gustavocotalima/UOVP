export const BALANCE_CATEGORIES = [
  "RECEIVABLES",
  "INVESTMENTS",
  "CASH",
  "VALUE_LIABILITY",
  "CURRENT_LIABILITY",
  "NON_CURRENT_LIABILITY",
] as const;

export type BalanceCategoryKey = (typeof BALANCE_CATEGORIES)[number];

export const BALANCE_META: Record<BalanceCategoryKey, { label: string; side: "asset" | "liability" }> = {
  RECEIVABLES: { label: "Contas a receber", side: "asset" },
  INVESTMENTS: { label: "Investimentos", side: "asset" },
  CASH: { label: "Disponibilidade", side: "asset" },
  VALUE_LIABILITY: { label: "Passivo de valor", side: "asset" },
  CURRENT_LIABILITY: { label: "Passivo circulante", side: "liability" },
  NON_CURRENT_LIABILITY: { label: "Não circulante", side: "liability" },
};
