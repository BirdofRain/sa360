"use server";

import { postAdminDirectDemoDelivery } from "@/lib/admin-api/server";
import type {
  DirectDemoDeliveryMode,
  DirectDemoDeliveryResponse,
} from "@/lib/direct-delivery-demo/types";
import { DIRECT_DEMO_LIVE_CONFIRMATION_TEXT } from "@/lib/direct-delivery-demo/types";

export async function runDirectDemoDeliveryAction(
  rawPayload: string,
  mode: DirectDemoDeliveryMode,
  confirmationText?: string
): Promise<{ ok: true; data: DirectDemoDeliveryResponse } | { ok: false; error: string; data?: DirectDemoDeliveryResponse }> {
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return { ok: false, error: "Payload must be valid JSON." };
  }

  const body = {
    payload,
    mode,
    confirmLiveDeliveryRisk: mode === "live_canary",
    operatorConfirmationText:
      mode === "live_canary" ? (confirmationText ?? "").trim() : "",
  };

  if (mode === "live_canary" && body.operatorConfirmationText !== DIRECT_DEMO_LIVE_CONFIRMATION_TEXT) {
    return {
      ok: false,
      error: `Type "${DIRECT_DEMO_LIVE_CONFIRMATION_TEXT}" to enable live canary.`,
    };
  }

  const res = await postAdminDirectDemoDelivery(body);
  if (res.data?.ok) {
    return { ok: true, data: res.data };
  }

  return {
    ok: false,
    error: res.error ?? "Direct demo delivery failed.",
    data: res.data ?? undefined,
  };
}
