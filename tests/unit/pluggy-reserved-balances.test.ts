import { describe, expect, it } from "vitest";
import { classifyPluggyInvestment } from "@/features/open-finance/diagram-classification";
import { pluggyAccountSchema } from "@/features/open-finance/pluggy";
import { extractAccountInvestmentSnapshots } from "@/features/open-finance/reserved-balances";

function account(overrides: Record<string, unknown> = {}) {
  return pluggyAccountSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    type: "BANK",
    subtype: "CHECKING_ACCOUNT",
    name: "Mercado Pago",
    marketingName: "Mercado Pago (Conta Pré-paga)",
    balance: 500,
    currencyCode: "BRL",
    createdAt: "2026-09-11T12:00:00.000Z",
    updatedAt: "2026-09-11T13:00:00.000Z",
    ...overrides,
  });
}

describe("saldos reservados de contas Pluggy", () => {
  it("importa cada Caixinha separadamente e ignora o saldo automático agregado", () => {
    const input = account({
      bankData: {
        hasReservedBalance: true,
        automaticallyInvestedBalance: 50,
        reservedBalances: [
          {
            name: "Pensando no Futuro",
            identification: "reserve-one",
            availableAmounts: [
              {
                amount: 100,
                currencyCode: "BRL",
                remuneration: {
                  indexer: "CDI",
                  rateType: "EXPONENCIAL",
                  calculation: "DIAS_UTEIS",
                  ratePeriodicity: "ANUAL",
                  postFixedIndexerPercentage: 1.2,
                },
              },
              {
                amount: 25,
                currencyCode: "BRL",
                remuneration: { indexer: "CDI" },
              },
            ],
          },
          {
            name: "Escondendo",
            identification: "reserve-two",
            availableAmounts: [{ amount: 0, currencyCode: "BRL" }],
          },
        ],
      },
    });

    const result = extractAccountInvestmentSnapshots(input);
    const repeated = extractAccountInvestmentSnapshots(input);

    expect(result).toMatchObject({
      managed: true,
      complete: true,
      mode: "DETAILED",
    });
    expect(result.snapshots).toHaveLength(2);
    expect(result.snapshots.map((snapshot) => ({
      source: snapshot.source,
      name: snapshot.name,
      balance: snapshot.balance,
      currencyCode: snapshot.currencyCode,
      rateType: snapshot.rateType,
    }))).toEqual([
      {
        source: "ACCOUNT_RESERVED_BALANCE",
        name: "Pensando no Futuro",
        balance: "125",
        currencyCode: "BRL",
        rateType: "CDI",
      },
      {
        source: "ACCOUNT_RESERVED_BALANCE",
        name: "Escondendo",
        balance: "0",
        currencyCode: "BRL",
        rateType: null,
      },
    ]);
    expect(repeated.snapshots.map((snapshot) => snapshot.pluggyInvestmentId))
      .toEqual(result.snapshots.map((snapshot) => snapshot.pluggyInvestmentId));
    expect(result.snapshots.some((snapshot) => snapshot.balance === "50")).toBe(false);
  });

  it("mantém a referência pelo nome quando a Pluggy muda a ordem das reservas sem identificação", () => {
    const bankData = {
      hasReservedBalance: true,
      reservedBalances: [
        {
          name: "Viagem",
          availableAmounts: [{ amount: 120, currencyCode: "BRL" }],
        },
        {
          name: "Reserva de emergência",
          availableAmounts: [{ amount: 300, currencyCode: "BRL" }],
        },
      ],
    };
    const original = extractAccountInvestmentSnapshots(account({ bankData }));
    const reordered = extractAccountInvestmentSnapshots(account({
      bankData: {
        ...bankData,
        reservedBalances: [...bankData.reservedBalances].reverse(),
      },
    }));

    expect(Object.fromEntries(original.snapshots.map((snapshot) => [
      snapshot.name,
      snapshot.pluggyInvestmentId,
    ]))).toEqual(Object.fromEntries(reordered.snapshots.map((snapshot) => [
      snapshot.name,
      snapshot.pluggyInvestmentId,
    ])));
  });

  it("usa o saldo automático somente quando não existem posições detalhadas", () => {
    const result = extractAccountInvestmentSnapshots(account({
      bankData: {
        automaticallyInvestedBalance: "42.50",
      },
    }));

    expect(result).toMatchObject({
      managed: true,
      complete: true,
      mode: "AUTOMATIC",
    });
    expect(result.snapshots).toEqual([
      expect.objectContaining({
        source: "ACCOUNT_AUTOMATIC_BALANCE",
        name: "Saldo investido automaticamente",
        balance: "42.5",
        currencyCode: "BRL",
      }),
    ]);
  });

  it("não cria posição agregada para saldo automático zerado", () => {
    expect(extractAccountInvestmentSnapshots(account({
      bankData: {
        automaticallyInvestedBalance: 0,
      },
    }))).toEqual({
      managed: true,
      complete: true,
      mode: "EMPTY",
      snapshots: [],
    });
  });

  it("não infere zero quando a instituição declara reservas sem informar os valores", () => {
    const result = extractAccountInvestmentSnapshots(account({
      bankData: {
        hasReservedBalance: true,
        reservedBalances: [{
          name: "Caixinha incompleta",
          identification: "incomplete",
          availableAmounts: null,
        }],
      },
    }));

    expect(result).toEqual({
      managed: true,
      complete: false,
      mode: "DETAILED",
      snapshots: [],
    });
  });

  it("aceita explicitamente uma conta sem saldos reservados", () => {
    expect(extractAccountInvestmentSnapshots(account({
      bankData: {
        hasReservedBalance: false,
        reservedBalances: [],
      },
    }))).toEqual({
      managed: true,
      complete: true,
      mode: "EMPTY",
      snapshots: [],
    });
  });

  it("sugere renda fixa pós-fixada, mas exige revisão do grupo", () => {
    const classification = classifyPluggyInvestment({
      id: "investment-db",
      pluggyInvestmentId: "uovp:account_reserved_balance:reference",
      source: "ACCOUNT_RESERVED_BALANCE",
      name: "Pensando no Futuro",
      code: null,
      type: "FIXED_INCOME",
      subtype: "RESERVED_BALANCE",
      rateType: "CDI",
      rate: null,
      fixedAnnualRate: null,
    });

    expect(classification).toMatchObject({
      instrumentType: "FIXED_INCOME",
      investmentClass: "FIXED_INCOME",
      familyCode: null,
      indexation: "POST_FIXED",
      needsReview: true,
    });
  });
});
