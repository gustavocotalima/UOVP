const BRAPI_GENERIC_LOGO_PATH = "/icons/brapi.svg";
const FMP_LOGO_BASE_URL = "https://financialmodelingprep.com/image-stock";

export function isGenericBrapiLogoUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase() === "icons.brapi.dev"
      && url.pathname.toLowerCase() === BRAPI_GENERIC_LOGO_PATH;
  } catch {
    return false;
  }
}

export function usableBrapiLogoUrl(value: string | null | undefined) {
  return value && !isGenericBrapiLogoUrl(value) ? value : null;
}

export function financialModelingPrepLogoUrl(ticker: string | null | undefined) {
  const symbol = ticker?.trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9.^=-]+$/.test(symbol)) return null;
  return `${FMP_LOGO_BASE_URL}/${encodeURIComponent(symbol)}.png`;
}
