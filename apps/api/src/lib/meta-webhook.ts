import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta (Facebook) Lead Ads webhook configuration and signature/verification helpers.
 *
 * All secrets are read from the environment on demand and never returned to clients
 * or written to logs. `redactWebhookPayloadForLog` additionally strips token-like keys
 * from any persisted payload.
 */
export type MetaWebhookConfig = {
  /** Token compared against `hub.verify_token` during the GET handshake. */
  verifyToken: string | null;
  /** App secret used to validate `X-Hub-Signature-256`. When null, signature checks are skipped. */
  appSecret: string | null;
  /** Page/system-user access token used to fetch full lead details from the Graph API. */
  accessToken: string | null;
  /** Graph API version, e.g. `v22.0`. */
  graphApiVersion: string;
  /** Master client account id used as routing input (env-driven; no tenant hardcoding). */
  masterClientAccountId: string | null;
  /** When false (default), the POST receiver verifies + persists raw events but does NOT call the Graph API. */
  directIntakeEnabled: boolean;
};

const DEFAULT_GRAPH_API_VERSION = "v22.0";

function envOrNull(name: string): string | null {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : null;
}

export function getMetaWebhookConfig(): MetaWebhookConfig {
  return {
    verifyToken: envOrNull("META_WEBHOOK_VERIFY_TOKEN"),
    appSecret: envOrNull("META_APP_SECRET"),
    accessToken: envOrNull("META_PAGE_ACCESS_TOKEN"),
    graphApiVersion: envOrNull("META_GRAPH_API_VERSION") ?? DEFAULT_GRAPH_API_VERSION,
    masterClientAccountId: envOrNull("SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID"),
    directIntakeEnabled: (process.env.FACEBOOK_DIRECT_INTAKE_ENABLED?.trim() ?? "false") === "true",
  };
}

export type MetaVerificationQuery = {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
};

export type MetaVerificationResult =
  | { ok: true; challenge: string }
  | { ok: false; reason: "missing_config" | "mode_mismatch" | "token_mismatch" | "missing_challenge" };

/**
 * Validate the Meta webhook subscription handshake.
 * Returns the challenge to echo on success, or a typed failure reason (caller returns 403).
 */
export function verifyMetaWebhookChallenge(
  query: MetaVerificationQuery,
  configuredVerifyToken: string | null
): MetaVerificationResult {
  if (!configuredVerifyToken) return { ok: false, reason: "missing_config" };
  if (query["hub.mode"] !== "subscribe") return { ok: false, reason: "mode_mismatch" };
  const provided = query["hub.verify_token"] ?? "";
  if (!safeEqualString(provided, configuredVerifyToken)) {
    return { ok: false, reason: "token_mismatch" };
  }
  const challenge = query["hub.challenge"];
  if (typeof challenge !== "string" || challenge.length === 0) {
    return { ok: false, reason: "missing_challenge" };
  }
  return { ok: true, challenge };
}

function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Parse the hex digest out of an `X-Hub-Signature-256: sha256=<hex>` header. */
function parseSignatureHeader(header: string | undefined): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  const match = /^sha256=([a-f0-9]+)$/i.exec(trimmed);
  return match ? match[1].toLowerCase() : null;
}

export type MetaSignatureResult =
  | { ok: true; skipped: boolean }
  | { ok: false; reason: "missing_signature" | "bad_signature" };

/**
 * Validate the `X-Hub-Signature-256` header against the raw request body.
 * When `appSecret` is null, validation is skipped (ok: true, skipped: true) per spec
 * ("validate signature if META_APP_SECRET is configured").
 */
export function validateMetaSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  appSecret: string | null
): MetaSignatureResult {
  if (!appSecret) return { ok: true, skipped: true };
  const provided = parseSignatureHeader(signatureHeader);
  if (!provided) return { ok: false, reason: "missing_signature" };

  const expected = createHmac("sha256", appSecret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
    .digest("hex");

  const providedBuf = Buffer.from(provided, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (providedBuf.length !== expectedBuf.length) return { ok: false, reason: "bad_signature" };
  return timingSafeEqual(providedBuf, expectedBuf)
    ? { ok: true, skipped: false }
    : { ok: false, reason: "bad_signature" };
}
