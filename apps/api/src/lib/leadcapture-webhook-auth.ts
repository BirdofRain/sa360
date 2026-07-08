import { timingSafeEqual } from "node:crypto";

export type LeadCaptureWebhookAuthResult =
  | { ok: true; devWarning?: string; method: "header" | "basic" }
  | { ok: false; reason: "missing" | "invalid" | "integration_not_configured"; hint?: string };

const DEFAULT_BASIC_AUTH_USERNAME = "sa360-leadcapture";

function isProductionEnvironment(): boolean {
  const env = (process.env.SA360_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return env === "production" || env === "prod";
}

function readEnvSecret(): string {
  const envRaw = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  return typeof envRaw === "string" ? envRaw.trim() : "";
}

function readBasicAuthUsername(): string {
  const envRaw = process.env.SA360_LEADCAPTURE_BASIC_AUTH_USERNAME;
  const trimmed = typeof envRaw === "string" ? envRaw.trim() : "";
  return trimmed || DEFAULT_BASIC_AUTH_USERNAME;
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length || !timingSafeEqual(ba, bb)) return false;
    return true;
  } catch {
    return false;
  }
}

function parseBasicAuth(authorizationHeader: string | undefined): {
  username: string;
  password: string;
} | null {
  if (!authorizationHeader?.startsWith("Basic ")) return null;
  const encoded = authorizationHeader.slice("Basic ".length).trim();
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep < 0) return null;
    return {
      username: decoded.slice(0, sep),
      password: decoded.slice(sep + 1),
    };
  } catch {
    return null;
  }
}

/**
 * Validates LeadCapture.io webhook auth via:
 * - `x-sa360-leadcapture-key` header, or
 * - HTTP Basic Auth (username from env, password = webhook secret).
 *
 * Fail-closed when secret env is set; permissive in dev when env is unset.
 */
export function validateLeadCaptureWebhookAuth(input: {
  headerKey?: string;
  authorizationHeader?: string;
}): LeadCaptureWebhookAuthResult {
  const env = readEnvSecret();

  if (!env) {
    if (isProductionEnvironment()) {
      return {
        ok: false,
        reason: "integration_not_configured",
        hint: "Set SA360_LEADCAPTURE_WEBHOOK_SECRET in the API environment.",
      };
    }
    return {
      ok: true,
      method: "header",
      devWarning:
        "SA360_LEADCAPTURE_WEBHOOK_SECRET is not set — webhook accepted without key validation (dev only).",
    };
  }

  const incomingHeader = typeof input.headerKey === "string" ? input.headerKey.trim() : "";
  if (incomingHeader && safeEqual(env, incomingHeader)) {
    return { ok: true, method: "header" };
  }

  const basic = parseBasicAuth(input.authorizationHeader);
  if (basic) {
    const expectedUser = readBasicAuthUsername();
    if (safeEqual(expectedUser, basic.username) && safeEqual(env, basic.password)) {
      return { ok: true, method: "basic" };
    }
    return { ok: false, reason: "invalid" };
  }

  if (!incomingHeader) {
    return { ok: false, reason: "missing" };
  }

  return { ok: false, reason: "invalid" };
}

/** @deprecated Use validateLeadCaptureWebhookAuth */
export function validateLeadCaptureWebhookKey(
  headerValue: string | undefined
):
  | { ok: true; devWarning?: string }
  | { ok: false; reason: "missing" | "invalid" | "integration_not_configured"; hint?: string } {
  const result = validateLeadCaptureWebhookAuth({ headerKey: headerValue });
  if (!result.ok) return result;
  return { ok: true, devWarning: result.devWarning };
}
