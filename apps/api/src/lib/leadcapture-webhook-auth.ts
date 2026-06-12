import { timingSafeEqual } from "node:crypto";

/**
 * Validates `x-sa360-leadcapture-key` against SA360_LEADCAPTURE_WEBHOOK_SECRET.
 * Fail-closed when env is set; permissive in dev when env is unset.
 */
export function validateLeadCaptureWebhookKey(
  headerValue: string | undefined
): { ok: true; devWarning?: string } | { ok: false; reason: "missing" | "invalid" } {
  const envRaw = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  const env = typeof envRaw === "string" ? envRaw.trim() : "";

  if (!env) {
    return {
      ok: true,
      devWarning:
        "SA360_LEADCAPTURE_WEBHOOK_SECRET is not set — webhook accepted without key validation (dev only).",
    };
  }

  const incoming = typeof headerValue === "string" ? headerValue.trim() : "";
  if (!incoming) {
    return { ok: false, reason: "missing" };
  }

  try {
    const ba = Buffer.from(env, "utf8");
    const bb = Buffer.from(incoming, "utf8");
    if (ba.length !== bb.length || !timingSafeEqual(ba, bb)) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
