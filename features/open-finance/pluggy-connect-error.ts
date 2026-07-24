const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DUPLICATE_ITEM_CODE = "ITEM_USER_ALREADY_EXISTS";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? value as UnknownRecord : null;
}

export function duplicatePluggyItemIds(error: unknown) {
  const details = record(error);
  if (!details) return [];

  const duplicate = [details.codeDescription, details.code, details.message]
    .some((value) => String(value ?? "").toUpperCase().includes(DUPLICATE_ITEM_CODE));
  if (!duplicate) return [];

  const data = record(details.data);
  const items = Array.isArray(data?.items) ? data.items : [];
  return [...new Set(items)]
    .filter((item): item is string => typeof item === "string" && UUID_PATTERN.test(item))
    .slice(0, 20);
}

export function pluggyConnectErrorMessage(error: unknown) {
  const details = record(error);
  const message = details?.message;
  return typeof message === "string" && message.trim()
    ? message
    : "A Pluggy não concluiu a conexão.";
}
