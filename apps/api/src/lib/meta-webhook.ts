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
  /**
   * Legacy alias of intake+graph+routing. True when `FACEBOOK_DIRECT_INTAKE_ENABLED=true`
   * or when `SA360_META_LEAD_ADS_INTAKE_ENABLED=true`. Defaults false.
   */
  directIntakeEnabled: boolean;
  /** Persist + process Meta Lead Ads notifications. Default false. */
  intakeEnabled: boolean;
  /** Call Meta Graph to fetch lead field data. Default false. */
  graphFetchEnabled: boolean;
  /** Run routing dry-run after normalize. Default false. */
  routingEnabled: boolean;
  /** Allow POST /sources/facebook/test-lead fixture. Default false. */
  fixtureEnabled: boolean;
};

const DEFAULT_GRAPH_API_VERSION = "v22.0";

function isProductionEnvironment(): boolean {
  const env = (process.env.SA360_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return env === "production" || env === "prod";
}

function envOrNull(name: string): string | null {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : null;
}

function envFlagEnabled(name: string): boolean {
  return (process.env[name]?.trim() ?? "").toLowerCase() === "true";
}

export function getMetaWebhookConfig(): MetaWebhookConfig {
  const legacyDirectIntake = envFlagEnabled("FACEBOOK_DIRECT_INTAKE_ENABLED");
  const intakeEnabled =
    envFlagEnabled("SA360_META_LEAD_ADS_INTAKE_ENABLED") || legacyDirectIntake;
  const graphFetchEnabled =
    envFlagEnabled("SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED") || legacyDirectIntake;
  const routingEnabled =
    envFlagEnabled("SA360_META_LEAD_ADS_ROUTING_ENABLED") || legacyDirectIntake;
  const fixtureEnabled = envFlagEnabled("SA360_META_LEAD_ADS_FIXTURE_ENABLED");
  return {
    verifyToken: envOrNull("META_WEBHOOK_VERIFY_TOKEN"),
    appSecret: envOrNull("META_APP_SECRET"),
    accessToken: envOrNull("META_PAGE_ACCESS_TOKEN"),
    graphApiVersion: envOrNull("META_GRAPH_API_VERSION") ?? DEFAULT_GRAPH_API_VERSION,
    masterClientAccountId: envOrNull("SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID"),
    directIntakeEnabled: intakeEnabled,
    intakeEnabled,
    graphFetchEnabled,
    routingEnabled,
    fixtureEnabled,
  };
}

/**
 * Strip `hub.verify_token` (and other token/secret query keys) from a request URL
 * before it is written to access logs. Handshake query strings must never persist
 * the verification token.
 */
export function redactSensitiveWebhookUrl(url: string): string {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return url;
  const path = url.slice(0, qIndex);
  const params = new URLSearchParams(url.slice(qIndex + 1));
  const oauthCallback = /\/oauth\/callback\/?$/i.test(path);
  let mutated = false;
  for (const key of [...params.keys()]) {
    if (
      /(?:^|[._-])(token|secret|password|access_token)$/i.test(key) ||
      /verify_token/i.test(key) ||
      (oauthCallback && /^(code|state|error_description)$/i.test(key))
    ) {
      params.set(key, "***REDACTED***");
      mutated = true;
    }
  }
  return mutated ? `${path}?${params.toString()}` : url;
}

/** Handshake log body: never includes `hub.verify_token` or any other secret. */
export function metaHandshakeLogBody(query: Record<string, string | undefined>): Record<string, unknown> {
  return {
    handshake: true,
    "hub.mode": query["hub.mode"] ?? null,
    "hub.challenge": query["hub.challenge"] ?? null,
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
  | { ok: false; reason: "missing_signature" | "bad_signature" | "missing_secret" };

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
  if (!appSecret) {
    if (isProductionEnvironment()) {
      return { ok: false, reason: "missing_secret" };
    }
    return { ok: true, skipped: true };
  }
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
