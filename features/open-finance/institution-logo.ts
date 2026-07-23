const PLUGGY_ICON_BASE = "https://cdn.pluggy.ai/assets/connector-icons";

// Pluggy's MeuPluggy connector uses a generic sandbox logo. The account still
// exposes the institution's COMPE code, which can be mapped to Pluggy's public
// connector icon.
const COMPE_TO_PLUGGY_ICON: Record<string, string> = {
  "001": "211.svg",
  "003": "679.svg",
  "004": "671.svg",
  "021": "681.svg",
  "033": "208.svg",
  "041": "659.svg",
  "047": "735.svg",
  "070": "682.svg",
  "077": "215.svg",
  "082": "734.svg",
  "085": "224.svg",
  "104": "219.svg",
  "133": "684.svg",
  "136": "663.svg",
  "208": "214.svg",
  "212": "654.svg",
  "213": "738.svg",
  "218": "723.svg",
  "237": "203.svg",
  "243": "680.svg",
  "260": "212.svg",
  "290": "692.svg",
  "318": "652.svg",
  "323": "206.svg",
  "330": "739.svg",
  "335": "653.svg",
  "336": "726.svg",
  "341": "201.svg",
  "348": "202.svg",
  "364": "686.svg",
  "376": "757.svg",
  "380": "651.svg",
  "389": "742.svg",
  "403": "250.svg",
  "422": "629.svg",
  "604": "731.svg",
  "623": "657.svg",
  "633": "769.svg",
  "637": "714.svg",
  "654": "740.svg",
  "707": "685.svg",
  "735": "689.svg",
  "748": "661.svg",
  "756": "228.svg",
};

function normalizeBankCode(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(0, 3).padStart(3, "0");
}

function isMeuPluggyPlaceholder(value: string | null | undefined) {
  if (!value) return true;
  try {
    return new URL(value).pathname.replace(/\/+$/, "").endsWith("/sandbox.svg");
  } catch {
    return value.split("?")[0]?.replace(/\/+$/, "").endsWith("/sandbox.svg") ?? false;
  }
}

export function pluggyInstitutionIconForBankCode(bankCode: string | null | undefined) {
  const normalized = normalizeBankCode(bankCode);
  const icon = normalized ? COMPE_TO_PLUGGY_ICON[normalized] : null;
  return icon ? `${PLUGGY_ICON_BASE}/${icon}` : null;
}

export function resolvePluggyInstitutionLogo(
  connectorImageUrl: string | null | undefined,
  bankCodes: Array<string | null | undefined>,
) {
  if (!isMeuPluggyPlaceholder(connectorImageUrl)) return connectorImageUrl ?? null;
  for (const bankCode of bankCodes) {
    const icon = pluggyInstitutionIconForBankCode(bankCode);
    if (icon) return icon;
  }
  return null;
}
