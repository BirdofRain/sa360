import {
  decryptAes256GcmToken,
  encryptAes256GcmToken,
  isNamedEncryptionKeyConfigured,
  loadNamedEncryptionKey,
} from "./token-encryption.js";

export const GHL_TOKEN_ENCRYPTION_KEY_ENV = "GHL_TOKEN_ENCRYPTION_KEY";

export function getGhlTokenEncryptionKey(): Buffer {
  return loadNamedEncryptionKey(GHL_TOKEN_ENCRYPTION_KEY_ENV);
}

export function isGhlTokenEncryptionConfigured(): boolean {
  return isNamedEncryptionKeyConfigured(GHL_TOKEN_ENCRYPTION_KEY_ENV);
}

/** Encrypt a token for storage. Never log plaintext. */
export function encryptGhlToken(plaintext: string): string {
  return encryptAes256GcmToken(plaintext, getGhlTokenEncryptionKey());
}

/** Decrypt a stored token. Server-side only. */
export function decryptGhlToken(ciphertext: string): string {
  return decryptAes256GcmToken(ciphertext, getGhlTokenEncryptionKey());
}
