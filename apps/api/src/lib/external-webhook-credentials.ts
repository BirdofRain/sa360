import { createHash } from "node:crypto";

import {
  decryptAes256GcmToken,
  encryptAes256GcmToken,
  isNamedEncryptionKeyConfigured,
  loadNamedEncryptionKey,
} from "./token-encryption.js";
import {
  validateExternalWebhookUrl,
  type ExternalWebhookResolver,
  type ExternalWebhookUrlRejection,
} from "./external-webhook-url-policy.js";

/**
 * Dedicated key for an external webhook URL and its optional HMAC secret.
 * Never fall back to SA360_CUSTOM_WEBHOOK_SECRET_KEY, META_TOKEN_ENCRYPTION_KEY,
 * GHL_TOKEN_ENCRYPTION_KEY, or GOOGLE_TOKEN_ENCRYPTION_KEY.
 */
export const EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV = "SA360_EXTERNAL_WEBHOOK_CREDENTIAL_KEY";

export function isExternalWebhookCredentialEncryptionConfigured(): boolean {
  return isNamedEncryptionKeyConfigured(EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV);
}

export function externalWebhookFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex").slice(0, 16);
}

export type SealedExternalWebhookEndpoint = {
  canonicalUrl: string;
  ciphertext: string;
  fingerprint: string;
  hostname: string;
  addresses: readonly string[];
};

export async function sealExternalWebhookEndpoint(
  raw: string,
  resolve: ExternalWebhookResolver
): Promise<
  { ok: true; endpoint: SealedExternalWebhookEndpoint } | { ok: false; code: ExternalWebhookUrlRejection }
> {
  const accepted = await validateExternalWebhookUrl(raw, resolve);
  if (!accepted.ok) return accepted;
  const ciphertext = encryptAes256GcmToken(
    accepted.canonicalUrl,
    loadNamedEncryptionKey(EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV)
  );
  return {
    ok: true,
    endpoint: {
      canonicalUrl: accepted.canonicalUrl,
      ciphertext,
      fingerprint: externalWebhookFingerprint(accepted.canonicalUrl),
      hostname: accepted.hostname,
      addresses: accepted.addresses,
    },
  };
}

export function decryptExternalWebhookUrl(ciphertext: string): string {
  if (typeof ciphertext !== "string" || !ciphertext.trim()) {
    throw new Error("External webhook URL ciphertext is missing.");
  }
  return decryptAes256GcmToken(ciphertext, loadNamedEncryptionKey(EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV));
}

export function encryptExternalWebhookSigningSecret(plaintext: string): {
  ciphertext: string;
  fingerprint: string;
} {
  if (typeof plaintext !== "string" || plaintext.trim().length === 0) {
    throw new Error("External webhook signing secret must be a non-empty string.");
  }
  return {
    ciphertext: encryptAes256GcmToken(
      plaintext,
      loadNamedEncryptionKey(EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV)
    ),
    fingerprint: externalWebhookFingerprint(plaintext),
  };
}

export function decryptExternalWebhookSigningSecret(ciphertext: string): string {
  if (typeof ciphertext !== "string" || !ciphertext.trim()) {
    throw new Error("External webhook signing secret ciphertext is missing.");
  }
  return decryptAes256GcmToken(ciphertext, loadNamedEncryptionKey(EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV));
}

export type ExternalWebhookReadMetadata = {
  present: boolean;
  kind: "ghl_inbound" | "external_https" | null;
  authMode: "none" | "hmac_sha256" | null;
  enabled: boolean;
  endpointHost: string | null;
  revision: number;
};

/** Team Workspace read shape. Hostname, kind, and revision only. */
export function toExternalWebhookReadMetadata(
  row: {
    kind: "ghl_inbound" | "external_https";
    authMode: "none" | "hmac_sha256";
    enabled: boolean;
    endpointHost: string;
    revision: number;
  } | null
): ExternalWebhookReadMetadata {
  if (!row) {
    return { present: false, kind: null, authMode: null, enabled: false, endpointHost: null, revision: 0 };
  }
  return {
    present: true,
    kind: row.kind,
    authMode: row.authMode,
    enabled: row.enabled,
    endpointHost: row.endpointHost,
    revision: row.revision,
  };
}
