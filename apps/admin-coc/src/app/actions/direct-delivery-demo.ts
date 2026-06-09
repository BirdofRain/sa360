"use server";

import { postAdminDirectDemoDelivery } from "@/lib/admin-api/server";
import { normalizeDirectDemoResult } from "@/lib/direct-delivery-demo/normalize-result";
import type {
  DirectDemoDeliveryMode,
  DirectDemoDeliveryViewModel,
} from "@/lib/direct-delivery-demo/types";
import { DIRECT_DEMO_LIVE_CONFIRMATION_TEXT } from "@/lib/direct-delivery-demo/types";

export type DirectDemoDeliveryActionResult =
  | { ok: true; data: DirectDemoDeliveryViewModel }
  | { ok: false; error: string; data?: DirectDemoDeliveryViewModel };

export async function runDirectDemoDeliveryAction(
  rawPayload: string,
  mode: DirectDemoDeliveryMode,
  confirmationText?: string
): Promise<DirectDemoDeliveryActionResult> {
  if (!rawPayload.trim()) {
    return { ok: false, error: "Paste a lifecycle JSON payload before running." };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return { ok: false, error: "Payload must be valid JSON." };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Payload must be a JSON object." };
  }

  const body = {
    payload,
    mode,
    confirmLiveDeliveryRisk: mode === "live_canary",
    operatorConfirmationText:
      mode === "live_canary" ? (confirmationText ?? "").trim() : "",
  };

  if (
    mode === "live_canary" &&
    body.operatorConfirmationText !== DIRECT_DEMO_LIVE_CONFIRMATION_TEXT
  ) {
    return {
      ok: false,
      error: `Type "${DIRECT_DEMO_LIVE_CONFIRMATION_TEXT}" to enable live canary.`,
    };
  }

  try {
    const res = await postAdminDirectDemoDelivery(body);
    const normalized = normalizeDirectDemoResult(res.data, mode);

    if (normalized.ok) {
      return { ok: true, data: normalized };
    }

    return {
      ok: false,
      error: res.error ?? normalized.reason ?? "Direct demo delivery failed.",
      data: normalized,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Direct demo delivery request failed.";
    return {
      ok: false,
      error: msg.slice(0, 500),
      data: normalizeDirectDemoResult(null, mode),
    };
  }
}
