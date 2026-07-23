import { describe, expect, it } from "vitest";
import { CATALOG_FAMILY_BY_ID, FIXED_INCOME_FAMILIES } from "@/features/portfolio/catalog";

describe("grupos de renda fixa", () => {
  it("consolida os produtos do Tesouro em uma família única", () => {
    const treasuryFamilies = FIXED_INCOME_FAMILIES.filter((family) => family.code.includes("TREASURY"));

    expect(treasuryFamilies).toEqual([expect.objectContaining({ code: "PUBLIC_TREASURY", name: "Tesouro Direto" })]);
    expect([1, 2, 3, 4, 15, 16, 17].map((id) => CATALOG_FAMILY_BY_ID[id])).toEqual(Array(7).fill("PUBLIC_TREASURY"));
  });
});
