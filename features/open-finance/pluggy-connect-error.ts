type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? value as UnknownRecord : null;
}

export function pluggyConnectErrorMessage(error: unknown) {
  const details = record(error);
  const message = details?.message;
  return typeof message === "string" && message.trim()
    ? message
    : "A Pluggy não concluiu a conexão.";
}
