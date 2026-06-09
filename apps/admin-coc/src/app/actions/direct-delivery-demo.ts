"use server";

import {
  fetchAdminGhlLiveDeliveryRun,
  postAdminDirectDemoDelivery,
} from "@/lib/admin-api/server";
import { normalizeDirectDemoResult } from "@/lib/direct-delivery-demo/normalize-result";
import type {
  DirectDemoDeliveryMode,
  DirectDemoDeliveryViewModel,
  DirectDemoLiveRunStepSummary,
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

export type LoadDirectDemoLiveRunDetailResult =
  | {
      ok: true;
      stepSummary: DirectDemoLiveRunStepSummary[];
      contactIdGhl: string | null;
      apiBuildVersion: DirectDemoDeliveryViewModel["apiBuildVersion"];
    }
  | { ok: false; error: string };

export async function loadDirectDemoLiveRunDetailAction(
  liveRunId: string
): Promise<LoadDirectDemoLiveRunDetailResult> {
  const trimmed = liveRunId.trim();
  if (!trimmed) return { ok: false, error: "Missing live run id." };

  try {
    const res = await fetchAdminGhlLiveDeliveryRun(trimmed);
    if (!res.data?.ok || !res.data.liveRun) {
      return { ok: false, error: res.error ?? "Live run not found." };
    }
    const normalized = normalizeDirectDemoResult(
      {
        ok: false,
        mode: "live_canary",
        liveRunStepSummary: res.data.stepSummary,
        contactIdGhl: res.data.liveRun.contactIdGhl,
        apiBuildVersion: res.data.apiBuildVersion,
      },
      "live_canary"
    );
    return {
      ok: true,
      stepSummary: normalized.liveRunStepSummary,
      contactIdGhl: res.data.liveRun.contactIdGhl ?? normalized.contactIdGhl,
      apiBuildVersion: normalized.apiBuildVersion,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load live run details.",
    };
  }
}
