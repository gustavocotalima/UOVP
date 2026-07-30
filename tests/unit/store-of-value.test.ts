import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { allocateContribution } from "@/features/portfolio/allocation";
import {
  DEFAULT_TARGETS,
  INVESTMENT_CLASSES,
  INVESTMENT_CLASS_META,
} from "@/features/portfolio/constants";
import { classifyPluggyInvestment } from "@/features/open-finance/diagram-classification";

describe("reserva de valor", () => {
  it("fica abaixo de renda fixa e começa com meta zero", () => {
    expect(INVESTMENT_CLASSES.indexOf("STORE_OF_VALUE"))
      .toBe(INVESTMENT_CLASSES.indexOf("FIXED_INCOME") + 1);
    expect(INVESTMENT_CLASS_META.STORE_OF_VALUE.label).toBe("Reserva de valor");
    expect(DEFAULT_TARGETS.STORE_OF_VALUE).toBe(0);
    expect(Object.values(DEFAULT_TARGETS).reduce((total, target) => total + target, 0)).toBe(100);
  });

  it("participa do aporte somente quando o usuário configura uma meta", () => {
    const asset = {
      id: "gold",
      ticker: "GOLD11",
      name: "Trend ETF LBMA Ouro",
      investmentClass: "STORE_OF_VALUE" as const,
      currentValue: 0,
      quantity: 0,
      unitPrice: 20,
      score: 5,
      fractional: false,
    };
    const withoutTarget = allocateContribution({
      contribution: 100,
      targets: DEFAULT_TARGETS,
      assets: [asset],
    });
    const withTarget = allocateContribution({
      contribution: 100,
      targets: {
        ...DEFAULT_TARGETS,
        BRAZILIAN_STOCKS: 0,
        STORE_OF_VALUE: 20,
      },
      assets: [asset],
    });

    expect(withoutTarget.suggestions).toHaveLength(0);
    expect(withTarget.suggestions[0]).toMatchObject({
      ticker: "GOLD11",
    });
    expect(withTarget.suggestions[0].quantity.isInteger()).toBe(true);
  });

  it("não reclassifica automaticamente ETFs informados pela Pluggy", () => {
    const classification = classifyPluggyInvestment({
      id: "db-gold",
      pluggyInvestmentId: "pluggy-gold",
      type: "ETF",
      subtype: "ETF",
      code: "GOLD11",
      name: "GOLD11",
      rateType: null,
      rate: null,
      fixedAnnualRate: null,
    });

    expect(classification.investmentClass).toBeNull();
    expect(classification.needsReview).toBe(true);
  });

  it("a migration cria somente metas e não reclassifica ativos existentes", () => {
    const enumMigration = readFileSync(
      new URL("../../prisma/migrations/20260730010000_store_of_value_allocation_class/migration.sql", import.meta.url),
      "utf8",
    );
    const targetsMigration = readFileSync(
      new URL("../../prisma/migrations/20260730010100_store_of_value_targets/migration.sql", import.meta.url),
      "utf8",
    );
    const migrations = `${enumMigration}\n${targetsMigration}`;

    expect(enumMigration).toContain("'STORE_OF_VALUE'");
    expect(enumMigration).not.toContain('INSERT INTO "InvestmentTarget"');
    expect(targetsMigration).toContain('INSERT INTO "InvestmentTarget"');
    expect(migrations).not.toMatch(/(?:UPDATE|DELETE FROM)\s+"Asset"/i);
  });
});
