import { createHash } from "node:crypto";

import {
  decryptAes256GcmToken,
  encryptAes256GcmToken,
  isNamedEncryptionKeyConfigured,
  loadNamedEncryptionKey,
} from "./token-encryption.js";

/**
 * Dedicated Meta Page / System User token key.
 * Never fall back to GHL_TOKEN_ENCRYPTION_KEY or GOOGLE_TOKEN_ENCRYPTION_KEY.
 */
export const META_TOKEN_ENCRYPTION_KEY_ENV = "META_TOKEN_ENCRYPTION_KEY";

export function isMetaTokenEncryptionConfigured(): boolean {
  return isNamedEncryptionKeyConfigured(META_TOKEN_ENCRYPTION_KEY_ENV);
}

export function encryptMetaToken(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.trim().length === 0) {
    throw new Error("Meta token plaintext must be a non-empty string.");
  }
  return encryptAes256GcmToken(plaintext, loadNamedEncryptionKey(META_TOKEN_ENCRYPTION_KEY_ENV));
}

export function decryptMetaToken(ciphertext: string): string {
  if (typeof ciphertext !== "string" || !ciphertext.trim()) {
    throw new Error("Meta token ciphertext is missing.");
  }
  return decryptAes256GcmToken(ciphertext, loadNamedEncryptionKey(META_TOKEN_ENCRYPTION_KEY_ENV));
}

/** Stable non-secret identifier so operators can distinguish stored credentials. */
export function metaTokenFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex").slice(0, 12);
}

/**
 * Remove token-like material from a diagnostic before it is stored or returned.
 * Secrets are optional extra values already in memory (never read back from logs).
 */
export function redactMetaSecretText(
  value: string,
  secrets: Array<string | null | undefined> = []
): string {
  let out = value;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join("***REDACTED***");
  }
  return out
    .replace(/EAA[A-Za-z0-9]{10,}/g, "***REDACTED***")
    .replace(
      /([?&\s]|^)((?:access_token|appsecret_proof|input_token|client_secret)=)[^&\s]+/gi,
      "$1$2***REDACTED***"
    )
    .slice(0, 500);
}
