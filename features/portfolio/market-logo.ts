const BRAPI_GENERIC_LOGO_PATH = "/icons/brapi.svg";

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
