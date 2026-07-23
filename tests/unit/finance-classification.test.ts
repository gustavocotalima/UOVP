import { describe, expect, it } from "vitest";
import {
  classifyProviderTransaction,
  financeRuleCandidates,
  normalizeFinanceRuleValue,
  preferredFinanceRuleCandidate,
} from "@/features/finance/classification";

describe("classificação financeira Pluggy", () => {
  it.each([
    ["Investments", "FINANCIAL_FREEDOM", []],
    ["Online Courses", "KNOWLEDGE", ["EDUCATION"]],
    ["Groceries", "FIXED_COSTS", ["FOOD"]],
    ["Electricity", "FIXED_COSTS", ["HOME"]],
    ["Food delivery", "PLEASURES", ["FOOD"]],
    ["Video streaming", "PLEASURES", ["LEISURE"]],
    ["Transportation", "COMFORT", ["TRANSPORT"]],
    ["Taxi and ride-hailing", "COMFORT", ["TRANSPORT"]],
    ["Vehicle maintenance", "COMFORT", ["TRANSPORT"]],
    ["Clothing", "COMFORT", ["CLOTHING"]],
    ["Account fees", "FIXED_COSTS", []],
    ["Urban land and building tax", "FIXED_COSTS", []],
    ["Taxes", "FIXED_COSTS", []],
  ] as const)("mapeia %s para a meta e tags esperadas", (providerCategory, budgetCategory, tagKeys) => {
    expect(classifyProviderTransaction({
      kind: "EXPENSE",
      description: "Teste",
      providerCategory,
    })).toEqual({
      recognized: true,
      budgetCategory,
      tagKeys: [...tagKeys],
      internalTransfer: false,
    });
  });

  it("não atribui meta de gasto a receitas", () => {
    expect(classifyProviderTransaction({
      kind: "INCOME",
      description: "Dividendos",
      providerCategory: "Proceeds interests and dividends",
    })).toEqual({
      recognized: false,
      budgetCategory: null,
      tagKeys: [],
      internalTransfer: false,
    });
  });

  it.each(["Same person transfer - PIX", "Credit card payment"])(
    "marca %s como transferência interna",
    (providerCategory) => {
      expect(classifyProviderTransaction({
        kind: "EXPENSE",
        description: "Transferência",
        providerCategory,
      }).internalTransfer).toBe(true);
    },
  );

  it.each(["Transfer - PIX", "Transfer - TED", "Transfer - Bank slip"])(
    "não adivinha a finalidade de %s",
    (providerCategory) => {
      expect(classifyProviderTransaction({
        kind: "EXPENSE",
        description: "Transferência",
        providerCategory,
      })).toEqual({
        recognized: false,
        budgetCategory: null,
        tagKeys: [],
        internalTransfer: false,
      });
    },
  );

  it("prioriza CNPJ, comerciante, contraparte, descrição e categoria nessa ordem", () => {
    const transaction = {
      kind: "EXPENSE" as const,
      description: "Compra 123",
      merchantCnpj: "12.345.678/0001-90",
      merchantName: "Mercado Exemplo",
      counterpartyName: "Recebedor Exemplo",
      providerCategory: "Shopping",
    };
    expect(financeRuleCandidates(transaction).map((candidate) => candidate.matchType)).toEqual([
      "MERCHANT_CNPJ",
      "MERCHANT_NAME",
      "COUNTERPARTY_NAME",
      "DESCRIPTION",
      "PROVIDER_CATEGORY",
    ]);
    expect(preferredFinanceRuleCandidate(transaction)).toMatchObject({
      matchType: "MERCHANT_CNPJ",
      matchValue: "12345678000190",
    });
  });

  it("normaliza regras exatas sem depender de caixa, acentos ou pontuação", () => {
    expect(normalizeFinanceRuleValue("MERCHANT_NAME", "  Café São João! ")).toBe("CAFE SAO JOAO");
    expect(normalizeFinanceRuleValue("DESCRIPTION", "PIX   enviado - José")).toBe("PIX ENVIADO JOSE");
  });

  it("usa razão social e descrição bruta como fallback estável para regras aprendidas", () => {
    expect(financeRuleCandidates({
      kind: "EXPENSE",
      description: "Descrição enriquecida",
      descriptionRaw: "COMPRA CARTAO 123",
      merchantBusinessName: "Comerciante S.A.",
    })).toEqual([
      {
        matchType: "MERCHANT_NAME",
        matchValue: "COMERCIANTE S A",
        matchLabel: "Comerciante S.A.",
      },
      {
        matchType: "DESCRIPTION",
        matchValue: "COMPRA CARTAO 123",
        matchLabel: "COMPRA CARTAO 123",
      },
    ]);
  });
});
