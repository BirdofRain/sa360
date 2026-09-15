import {
  decryptAes256GcmToken,
  encryptAes256GcmToken,
  isNamedEncryptionKeyConfigured,
  loadNamedEncryptionKey,
} from "./token-encryption.js";

/**
 * Dedicated Google OAuth token key. Never fall back to GHL_TOKEN_ENCRYPTION_KEY.
 */
export const GOOGLE_TOKEN_ENCRYPTION_KEY_ENV = "GOOGLE_TOKEN_ENCRYPTION_KEY";

export function getGoogleTokenEncryptionKey(): Buffer {
  return loadNamedEncryptionKey(GOOGLE_TOKEN_ENCRYPTION_KEY_ENV);
}

export function isGoogleTokenEncryptionConfigured(): boolean {
  return isNamedEncryptionKeyConfigured(GOOGLE_TOKEN_ENCRYPTION_KEY_ENV);
}

/** Encrypt a Google OAuth secret for storage. Never log plaintext. */
export function encryptGoogleToken(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Google token plaintext must be a non-empty string.");
  }
  return encryptAes256GcmToken(plaintext, getGoogleTokenEncryptionKey());
}

/** Decrypt a stored Google OAuth secret. Server-side only. */
export function decryptGoogleToken(ciphertext: string): string {
  if (typeof ciphertext !== "string" || !ciphertext.trim()) {
    throw new Error("Google token ciphertext is missing.");
  }
  return decryptAes256GcmToken(ciphertext, getGoogleTokenEncryptionKey());
}
