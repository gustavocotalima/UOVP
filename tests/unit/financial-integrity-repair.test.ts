import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  parseFinancialIntegrityRepairOptions,
  planReportingAmountRepair,
  type ReportingRepairInput,
} from "@/scripts/helpers/financial-integrity-repair";

const decimal = (value: string) => new Prisma.Decimal(value);
const native = (overrides: Partial<ReportingRepairInput> = {}): ReportingRepairInput => ({
  amount: decimal("-120"), currencyCode: "BRL", reportingAmountBrl: decimal("-100"),
  fxRateToBrl: decimal("1"), fxSource: "NATIVE", ...overrides,
});

describe("reparo conservador de integridade financeira", () => {
  it("é dry-run por padrão e limita o tamanho dos lotes", () => {
    expect(parseFinancialIntegrityRepairOptions([])).toEqual({ apply: false, userId: undefined, batchSize: 100 });
    expect(parseFinancialIntegrityRepairOptions(["--apply", "--user-id=user_1", "--batch-size=20"]))
      .toEqual({ apply: true, userId: "user_1", batchSize: 20 });
    for (const args of [["--batch-size=0"], ["--batch-size=501"], ["--apply=true"], ["--apply", "--apply"], ["--user-id="], ["--user-id=user\n1"], ["--unknown"]]) {
      expect(() => parseFinancialIntegrityRepairOptions(args)).toThrow();
    }
  });

  it("repara somente BRL nativo comprovado, inclusive relatório ausente", () => {
    expect(planReportingAmountRepair(native())).toEqual({ status: "REPAIRABLE_NATIVE_BRL", expected: decimal("-120") });
    expect(planReportingAmountRepair(native({ reportingAmountBrl: null })))
      .toEqual({ status: "REPAIRABLE_NATIVE_BRL", expected: decimal("-120") });
    expect(planReportingAmountRepair(native({ amount: decimal("120.125") })))
      .toEqual({ status: "REPAIRABLE_NATIVE_BRL", expected: decimal("120.13") });
  });

  it("mantém valores já corretos sem escrita", () => {
    expect(planReportingAmountRepair(native({ reportingAmountBrl: decimal("-120") }))).toEqual({ status: "UNCHANGED" });
    expect(planReportingAmountRepair(native({ currencyCode: "USD", fxSource: "YAHOO", fxRateToBrl: decimal("5"), reportingAmountBrl: decimal("-600") })))
      .toEqual({ status: "UNCHANGED" });
  });

  it("não infere a moeda ou a data de um snapshot estrangeiro legado", () => {
    expect(planReportingAmountRepair(native({ currencyCode: "USD", fxSource: "YAHOO", fxRateToBrl: decimal("5") })))
      .toEqual({ status: "REVIEW_REQUIRED", reason: "UNVERIFIED_RATE_CURRENCY" });
    expect(planReportingAmountRepair(native({ fxSource: "MANUAL" }))).toEqual({ status: "REVIEW_REQUIRED", reason: "UNVERIFIED_RATE_CURRENCY" });
    expect(planReportingAmountRepair(native({ fxRateToBrl: decimal("5") }))).toEqual({ status: "REVIEW_REQUIRED", reason: "UNVERIFIED_RATE_CURRENCY" });
  });

  it("preserva registros com taxa ausente, negativa ou não finita", () => {
    for (const fxRateToBrl of [null, decimal("0"), decimal("-1"), decimal("NaN"), decimal("Infinity")]) {
      expect(planReportingAmountRepair(native({ fxRateToBrl })))
        .toEqual({ status: "REVIEW_REQUIRED", reason: "MISSING_OR_INVALID_RATE" });
    }
  });
});
