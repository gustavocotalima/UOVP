import { describe, expect, it } from "vitest";
import {
  pluggyInstitutionIconForBankCode,
  pluggyInstitutionNameForBankCode,
  resolvePluggyInvestmentIssuer,
  resolvePluggyInstitutionLogo,
  resolvePluggyInstitutionName,
} from "@/features/open-finance/institution-logo";

describe("Pluggy institution logos", () => {
  it("keeps a real connector logo", () => {
    const logo = "https://cdn.pluggy.ai/assets/connector-icons/999.svg";
    expect(resolvePluggyInstitutionLogo(logo, ["348"])).toBe(logo);
  });

  it("replaces MeuPluggy's sandbox logo using the COMPE bank code", () => {
    expect(
      resolvePluggyInstitutionLogo(
        "https://cdn.pluggy.ai/assets/connector-icons/sandbox.svg",
        ["348"],
      ),
    ).toBe("https://cdn.pluggy.ai/assets/connector-icons/202.svg");
  });

  it("normalizes shorter COMPE codes", () => {
    expect(pluggyInstitutionIconForBankCode("77")).toBe(
      "https://cdn.pluggy.ai/assets/connector-icons/215.svg",
    );
  });

  it("uses a sibling account bank code when the current account omits it", () => {
    expect(
      resolvePluggyInstitutionLogo(
        "https://cdn.pluggy.ai/assets/connector-icons/sandbox.svg",
        [null, "348"],
      ),
    ).toBe("https://cdn.pluggy.ai/assets/connector-icons/202.svg");
  });

  it("uses the generic UI fallback when the bank code is unknown", () => {
    expect(
      resolvePluggyInstitutionLogo(
        "https://cdn.pluggy.ai/assets/connector-icons/sandbox.svg",
        ["999"],
      ),
    ).toBeNull();
  });

  it("resolves MeuPluggy connections to the real institution name", () => {
    expect(resolvePluggyInstitutionName(null, "MeuPluggy", ["077"])).toBe("Inter");
    expect(resolvePluggyInstitutionName("MeuPluggy", "MeuPluggy", ["348"])).toBe("XP Banking");
  });

  it("preserves an explicit institution name", () => {
    expect(resolvePluggyInstitutionName("BTG Investimentos", "MeuPluggy", ["208"])).toBe(
      "BTG Investimentos",
    );
  });

  it("normalizes bank codes when resolving names", () => {
    expect(pluggyInstitutionNameForBankCode("77")).toBe("Inter");
  });

  it("ignores generic Pluggy placeholders when resolving an investment issuer", () => {
    expect(
      resolvePluggyInvestmentIssuer("MeuPluggy", "Pluggy", "Inter", "MeuPluggy"),
    ).toBe("Inter");
    expect(
      resolvePluggyInvestmentIssuer("Banco Agibank S.A.", "MeuPluggy", "XP Banking", "MeuPluggy"),
    ).toBe("Banco Agibank S.A.");
  });

  it("does not expose MeuPluggy as an investment issuer", () => {
    expect(
      resolvePluggyInvestmentIssuer("MeuPluggy", null, null, "MeuPluggy"),
    ).toBe("Instituição");
  });
});
