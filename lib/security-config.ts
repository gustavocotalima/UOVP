const PLACEHOLDER_FRAGMENTS = [
  "replace-with",
  "change-me",
  "changeme",
  "example",
  "placeholder",
  "your-secret",
  "generate-a-",
];

export function requireSecureSecret(name: string, minimumLength = 32) {
  const value = process.env[name]?.trim();
  if (
    !value
    || value.length < minimumLength
    || PLACEHOLDER_FRAGMENTS.some((fragment) => value.toLowerCase().includes(fragment))
  ) {
    throw new Error(`${name} deve conter pelo menos ${minimumLength} caracteres aleatórios e não pode usar um valor de exemplo.`);
  }
  return value;
}

export function validateProductionSecurityConfig() {
  if (
    process.env.NODE_ENV !== "production"
    || process.env.NEXT_PHASE === "phase-production-build"
  ) return;
  if (process.env.AUTH_TRUST_PROXY !== "true" || process.env.AUTH_TRUST_HOST !== "true") {
    throw new Error("Em produção, AUTH_TRUST_PROXY e AUTH_TRUST_HOST precisam ser true.");
  }
  const authUrl = process.env.AUTH_URL?.trim();
  if (!authUrl) throw new Error("AUTH_URL precisa apontar para a origem pública da aplicação.");
  const parsed = new URL(authUrl);
  if (
    parsed.protocol !== "https:"
    || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
  ) {
    throw new Error("AUTH_URL precisa usar HTTPS e a origem pública em produção.");
  }
  if (!(process.env.APP_ADMIN_EMAILS ?? "").split(",").some((email) => email.trim())) {
    throw new Error("APP_ADMIN_EMAILS precisa conter ao menos um administrador.");
  }
}
