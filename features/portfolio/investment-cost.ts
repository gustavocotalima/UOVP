import { Prisma } from "@/generated/prisma/client";

export type InvestmentCostInput = {
  investedValue?: number | null;
  investedValueCurrency?: string | null;
};

/** An omitted pair preserves stored cost; null explicitly clears both fields. */
export function investmentCostUpdate(input: InvestmentCostInput): {
  investedValue?: Prisma.Decimal | null;
  investedValueCurrency?: string | null;
} {
  if (input.investedValue === undefined) {
    if (input.investedValueCurrency !== undefined) {
      throw new Error("Informe o custo ao alterar a moeda do investimento.");
    }
    return {};
  }
  if (input.investedValue === null) {
    if (input.investedValueCurrency != null) {
      throw new Error("Limpe também a moeda ao remover o custo do investimento.");
    }
    return { investedValue: null, investedValueCurrency: null };
  }
  const currency = input.investedValueCurrency?.trim().toUpperCase();
  if (!currency || !/^[A-Z0-9]{3,8}$/.test(currency)) {
    throw new Error("Informe a moeda do custo do investimento.");
  }
  if (!Number.isFinite(input.investedValue) || input.investedValue < 0) {
    throw new Error("Informe um custo de investimento válido maior ou igual a zero.");
  }
  return { investedValue: new Prisma.Decimal(input.investedValue), investedValueCurrency: currency };
}

/** Do not turn the cost of a new purchase into the cost of an older unknown position. */
export function addInvestmentCost(input: {
  investedValue: Prisma.Decimal | null;
  investedValueCurrency: string | null;
  hasPriorPosition: boolean;
  additions: ReadonlyMap<string, Prisma.Decimal>;
}) {
  const brlAddition = input.additions.get("BRL");
  if (!brlAddition?.isFinite() || brlAddition.lt(0)) {
    throw new Error("O aporte precisa informar um valor válido em BRL.");
  }
  if (input.investedValue == null) {
    if (input.hasPriorPosition) return { investedValue: null, investedValueCurrency: null };
    return { investedValue: brlAddition, investedValueCurrency: "BRL" };
  }
  const currency = input.investedValueCurrency;
  const addition = currency ? input.additions.get(currency) : undefined;
  if (!currency || !addition) {
    throw new Error("A moeda do custo não é compatível com este aporte. Revise o custo antes de continuar.");
  }
  return { investedValue: input.investedValue.add(addition), investedValueCurrency: currency };
}
