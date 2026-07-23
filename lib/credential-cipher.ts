import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v2";

export type CredentialContext = {
  userId: string;
  type: "brapi";
};

function associatedData(context: CredentialContext) {
  return Buffer.from(`aurum:${context.type}:${context.userId}:${ENVELOPE_VERSION}`, "utf8");
}

function parseKeyring() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEYS;
  const activeKeyId = process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY;
  if (!raw || !activeKeyId || raw.includes("<base64url")) {
    throw new Error("Configure CREDENTIAL_ENCRYPTION_KEYS e CREDENTIAL_ENCRYPTION_ACTIVE_KEY.");
  }

  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(",")) {
    const separator = entry.indexOf(":");
    if (separator < 1) throw new Error("CREDENTIAL_ENCRYPTION_KEYS possui formato inválido.");
    const keyId = entry.slice(0, separator).trim();
    const encoded = entry.slice(separator + 1).trim();
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(keyId)) throw new Error("Identificador de chave inválido.");
    const key = Buffer.from(encoded, "base64url");
    if (key.length !== 32) throw new Error(`A chave ${keyId} precisa ter exatamente 32 bytes.`);
    keys.set(keyId, key);
  }
  const activeKey = keys.get(activeKeyId);
  if (!activeKey) throw new Error("A chave ativa não existe em CREDENTIAL_ENCRYPTION_KEYS.");
  return { keys, activeKeyId, activeKey };
}

function legacyEncryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32 || secret.includes("replace-with")) {
    throw new Error("A credencial antiga não pode ser migrada sem o AUTH_SECRET original.");
  }
  return createHash("sha256").update(`aurum:user-credentials:${secret}`).digest();
}

export function encryptCredential(value: string, context: CredentialContext) {
  const { activeKeyId, activeKey } = parseKeyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, activeKey, iv);
  cipher.setAAD(associatedData(context));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    activeKeyId,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptCredential(payload: string, context: CredentialContext) {
  const values = payload.split(".");

  if (values[0] === ENVELOPE_VERSION) {
    const [version, keyId, ivValue, authTagValue, ciphertextValue] = values;
    if (version !== ENVELOPE_VERSION || !keyId || !ivValue || !authTagValue || !ciphertextValue) {
      throw new Error("Credencial armazenada em formato inválido.");
    }
    const { keys, activeKeyId } = parseKeyring();
    const key = keys.get(keyId);
    if (!key) throw new Error(`A chave ${keyId} necessária para descriptografar a credencial não está disponível.`);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivValue, "base64url"));
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
    const value = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return { value, needsRotation: keyId !== activeKeyId };
  }

  const [version, ivValue, authTagValue, ciphertextValue] = values;
  if (version !== "v1" || !ivValue || !authTagValue || !ciphertextValue) {
    throw new Error("Credencial armazenada em formato inválido.");
  }
  const decipher = createDecipheriv(ALGORITHM, legacyEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
  const value = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return { value, needsRotation: true };
}
