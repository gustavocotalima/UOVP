import { describe, expect, it } from "vitest";
import { formatCurrency } from "@/lib/money";

describe("formatação monetária", () => {
  it("formata moedas ISO normalmente", () => {
    expect(formatCurrency(1234.56, "USD")).toContain("1.234,56");
  });

  it("não quebra a renderização para ativos monetários não ISO", () => {
    expect(formatCurrency("123.456789", "USDT")).toBe("USDT 123,456789");
  });
});
