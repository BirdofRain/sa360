import { createHash } from "node:crypto";

import { validateDeliveryTargetMetadata } from "./delivery-target-metadata.validation.js";
import {
  decryptAes256GcmToken,
  encryptAes256GcmToken,
  isNamedEncryptionKeyConfigured,
  loadNamedEncryptionKey,
} from "./token-encryption.js";

/**
 * Dedicated outbound custom-webhook signing-secret key.
 * Never fall back to META_TOKEN_ENCRYPTION_KEY, GHL_TOKEN_ENCRYPTION_KEY,
 * or GOOGLE_TOKEN_ENCRYPTION_KEY.
 */
export const CUSTOM_WEBHOOK_SECRET_KEY_ENV = "SA360_CUSTOM_WEBHOOK_SECRET_KEY";

const REDACTED = "***REDACTED***";

/** Keys that must not survive into logs, tickets, API metadata, or config JSON. */
const SECRET_MATERIAL_KEY =
  /token|secret|password|apikey|api_key|authorization|credential|privatekey|private_key|oauth|bearer|refresh|ciphertext/i;

const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const RECEIPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isCustomWebhookSecretEncryptionConfigured(): boolean {
  return isNamedEncryptionKeyConfigured(CUSTOM_WEBHOOK_SECRET_KEY_ENV);
}

export function encryptCustomWebhookSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.trim().length === 0) {
    throw new Error("Custom webhook signing secret must be a non-empty string.");
  }
  return encryptAes256GcmToken(plaintext, loadNamedEncryptionKey(CUSTOM_WEBHOOK_SECRET_KEY_ENV));
}

export function decryptCustomWebhookSecret(ciphertext: string): string {
  if (typeof ciphertext !== "string" || !ciphertext.trim()) {
    throw new Error("Custom webhook signing secret ciphertext is missing.");
  }
  return decryptAes256GcmToken(ciphertext, loadNamedEncryptionKey(CUSTOM_WEBHOOK_SECRET_KEY_ENV));
}

/** Stable non-secret identifier. SHA-256 hex prefix; not reversible to the secret. */
export function customWebhookSecretFingerprint(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.trim().length === 0) {
    throw new Error("Custom webhook signing secret must be a non-empty string.");
  }
  return createHash("sha256").update(plaintext, "utf8").digest("hex").slice(0, 16);
}

export type CustomWebhookReadMetadata = {
  present: boolean;
  enabled: boolean;
  endpointHost: string | null;
};

export type CustomWebhookWriteMetadata = {
  endpointHost: string | null;
  secretFingerprint: string;
  enabled: boolean;
  revision: number;
};

/** Team Workspace read shape. Hostname only. No URL, ciphertext, or plaintext. */
export function toCustomWebhookReadMetadata(
  row: { endpointUrl: string; enabled: boolean } | null
): CustomWebhookReadMetadata {
  if (!row) {
    return { present: false, enabled: false, endpointHost: null };
  }
  return {
    present: true,
    enabled: row.enabled,
    endpointHost: customWebhookEndpointHost(row.endpointUrl),
  };
}

/** Later write response. Fingerprint is not a secret. Ciphertext and URL stay off. */
export function toCustomWebhookWriteMetadata(row: {
  endpointUrl: string;
  signingSecretFingerprint: string;
  enabled: boolean;
  revision: number;
}): CustomWebhookWriteMetadata {
  return {
    endpointHost: customWebhookEndpointHost(row.endpointUrl),
    secretFingerprint: row.signingSecretFingerprint,
    enabled: row.enabled,
    revision: row.revision,
  };
}

/** Hostname only, and only for https. No userinfo, port, path, or query. */
export function customWebhookEndpointHost(endpointUrl: string): string | null {
  try {
    const url = new URL(endpointUrl);
    if (url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.hostname;
  } catch {
    return null;
  }
}

export type TeamWorkspaceTicketContext = {
  teamWorkspace: {
    contractVersion: "team_workspace_delivery_v1";
    clientAccountId: string | null;
    sourceLeadEventId: string | null;
    sheetsJobId: string | null;
    ghlLiveRunId: string | null;
    customWebhookAttemptId: string | null;
  };
};

/**
 * Allowlisted ticket ids only. Endpoint URLs, signing secrets, ciphertext,
 * lead phones, and emails are dropped even if the caller passed them.
 */
export function sanitizeTeamWorkspaceTicketContext(input: unknown): TeamWorkspaceTicketContext {
  const source = nestedRecord(input, "teamWorkspace") ?? asRecord(input);
  return {
    teamWorkspace: {
      contractVersion: "team_workspace_delivery_v1",
      clientAccountId: allowId(source?.clientAccountId, CLIENT_ID_PATTERN),
      sourceLeadEventId: allowId(source?.sourceLeadEventId, RECEIPT_ID_PATTERN),
      sheetsJobId: allowId(source?.sheetsJobId, RECEIPT_ID_PATTERN),
      ghlLiveRunId: allowId(source?.ghlLiveRunId, RECEIPT_ID_PATTERN),
      customWebhookAttemptId: allowId(source?.customWebhookAttemptId, RECEIPT_ID_PATTERN),
    },
  };
}

/**
 * Metadata safe to store on DeliveryTarget.configMetadataJson.
 * The signing secret is not a parameter. Secret-bearing keys are rejected
 * by validateDeliveryTargetMetadata before anything is returned.
 */
export function customWebhookDeliveryTargetMetadata(input: {
  endpointHost?: string | null;
}): { ok: true; configMetadataJson: Record<string, unknown> } | { ok: false; paths: string[] } {
  const configMetadataJson: Record<string, unknown> = {};
  const host = input.endpointHost?.trim();
  if (host) configMetadataJson.endpointHost = host;
  const validation = validateDeliveryTargetMetadata(configMetadataJson);
  if (!validation.ok) return { ok: false, paths: validation.paths };
  return { ok: true, configMetadataJson };
}

/**
 * Drop secret-bearing keys and scrub known plaintext or ciphertext from a
 * value before it is logged or returned. Does not log.
 */
export function redactCustomWebhookMaterial(
  value: unknown,
  knownSecrets: ReadonlyArray<string | null | undefined> = []
): unknown {
  const secrets = knownSecrets.filter(
    (secret): secret is string => typeof secret === "string" && secret.length > 0
  );
  return walk(value, secrets);
}

function walk(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return scrubString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => walk(item, secrets));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_MATERIAL_KEY.test(key)) continue;
    if (/^endpointUrl$/i.test(key) || key === "endpoint_url") continue;
    out[key] = walk(nested, secrets);
  }
  return out;
}

function scrubString(value: string, secrets: string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join(REDACTED);
  }
  return out;
}

function allowId(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!pattern.test(trimmed)) return null;
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  return asRecord(record[key]);
}
