import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-256-GCM token ciphertext format: `iv.tag.ciphertext` (each base64url). */
export const AES_256_GCM_TOKEN_ALGO = "aes-256-gcm" as const;

export function deriveAes256GcmKey(raw: string): Buffer {
  if (raw.length === 64 && /^[0-9a-f]+$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw).digest();
}

export function isNamedEncryptionKeyConfigured(envName: string): boolean {
  return Boolean(process.env[envName]?.trim());
}

/**
 * Load a 32-byte AES key from a named env var. Fail closed — never substitute
 * another provider's key when this variable is missing or blank.
 */
export function loadNamedEncryptionKey(envName: string): Buffer {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    throw new Error(`${envName} is not configured.`);
  }
  return deriveAes256GcmKey(raw);
}

/** Encrypt a secret for storage. Never log plaintext. */
export function encryptAes256GcmToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_256_GCM_TOKEN_ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

/** Decrypt a stored secret. Server-side only. */
export function decryptAes256GcmToken(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format.");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const decipher = createDecipheriv(AES_256_GCM_TOKEN_ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
