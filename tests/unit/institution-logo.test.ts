import { describe, expect, it } from "vitest";
import {
  pluggyInstitutionIconForBankCode,
  resolvePluggyInstitutionLogo,
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
});
