import { timingSafeEqual } from "node:crypto";

export const ZAPIER_FACEBOOK_WEBHOOK_KEY_HEADER = "x-sa360-zapier-facebook-key";
export const ZAPIER_FACEBOOK_WEBHOOK_SECRET_ENV = "SA360_ZAPIER_FACEBOOK_WEBHOOK_SECRET";

export type ZapierFacebookWebhookAuthResult =
  | { ok: true; method: "header"; devWarning?: string }
  | { ok: false; reason: "missing" | "invalid" | "integration_not_configured"; hint?: string };

function readEnvSecret(): string {
  const envRaw = process.env[ZAPIER_FACEBOOK_WEBHOOK_SECRET_ENV];
  return typeof envRaw === "string" ? envRaw.trim() : "";
}

function isProductionEnvironment(): boolean {
  const env = (process.env.SA360_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return env === "production";
}

function safeEqual(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

/**
 * Zapier Facebook capture auth. Separate from Meta signature verification and
 * from the LeadConduit webhook secret. Fail closed in production when unset.
 */
export function validateZapierFacebookWebhookAuth(input: {
  headerKey?: string;
}): ZapierFacebookWebhookAuthResult {
  const env = readEnvSecret();
  if (!env) {
    if (isProductionEnvironment()) {
      return {
        ok: false,
        reason: "integration_not_configured",
        hint: `Set ${ZAPIER_FACEBOOK_WEBHOOK_SECRET_ENV} in the API environment.`,
      };
    }
    return {
      ok: true,
      method: "header",
      devWarning: `${ZAPIER_FACEBOOK_WEBHOOK_SECRET_ENV} is not set — webhook accepted without key validation (dev only).`,
    };
  }

  const incoming = typeof input.headerKey === "string" ? input.headerKey.trim() : "";
  if (!incoming) return { ok: false, reason: "missing" };
  if (!safeEqual(env, incoming)) return { ok: false, reason: "invalid" };
  return { ok: true, method: "header" };
}
