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
