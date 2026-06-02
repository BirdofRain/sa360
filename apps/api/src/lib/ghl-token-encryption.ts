import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

function deriveKey(raw: string): Buffer {
  if (raw.length === 64 && /^[0-9a-f]+$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw).digest();
}

export function getGhlTokenEncryptionKey(): Buffer {
  const raw = process.env.GHL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("GHL_TOKEN_ENCRYPTION_KEY is not configured.");
  }
  return deriveKey(raw);
}

export function isGhlTokenEncryptionConfigured(): boolean {
  return Boolean(process.env.GHL_TOKEN_ENCRYPTION_KEY?.trim());
}

/** Encrypt a token for storage. Never log plaintext. */
export function encryptGhlToken(plaintext: string): string {
  const key = getGhlTokenEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

/** Decrypt a stored token. Server-side only. */
export function decryptGhlToken(ciphertext: string): string {
  const key = getGhlTokenEncryptionKey();
  const parts = ciphertext.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format.");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
