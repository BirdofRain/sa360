"use server";

import {
  fetchAdminGhlLiveCanaryPreflight,
  postAdminGhlLiveCanaryExecute,
} from "@/lib/admin-api/server";
import type {
  GhlLiveCanaryExecuteResponse,
  GhlLiveCanaryPreflightResponse,
  GhlLiveDeliveryRunItem,
} from "@/lib/ghl-live-canary/types";

export type LoadGhlLiveCanaryPreflightResult =
  | { ok: true; preflight: GhlLiveCanaryPreflightResponse }
  | { ok: false; error: string };

export async function loadGhlLiveCanaryPreflightAction(
  planId: string
): Promise<LoadGhlLiveCanaryPreflightResult> {
  const res = await fetchAdminGhlLiveCanaryPreflight(planId);
  if (!res.data) return { ok: false, error: res.error ?? "Preflight failed." };
  return { ok: true, preflight: res.data };
}

export type ExecuteGhlLiveCanaryActionResult =
  | {
      ok: true;
      liveRun: GhlLiveDeliveryRunItem;
      contactIdGhl: string | null;
      opportunityIdGhl: string | null;
      workflowStarted: boolean;
      externalCallExecuted: boolean;
      safetyMessage: string;
    }
  | {
      ok: false;
      error: string;
      blockers?: string[];
      liveRun?: GhlLiveDeliveryRunItem;
      skippedDuplicate?: boolean;
    };

export async function executeGhlLiveCanaryAction(
  planId: string,
  operatorConfirmationText: string
): Promise<ExecuteGhlLiveCanaryActionResult> {
  const res = await postAdminGhlLiveCanaryExecute(planId, {
    confirmLiveDeliveryRisk: true,
    operatorConfirmationText,
  });
  const data = res.data as GhlLiveCanaryExecuteResponse | null;
  if (!data) {
    return { ok: false, error: res.error ?? "Live canary execution failed." };
  }
  if (data.skippedDuplicate && data.liveRun) {
    return {
      ok: false,
      error: "Skipped duplicate — a succeeded run already exists for this idempotency key.",
      skippedDuplicate: true,
      liveRun: data.liveRun,
    };
  }
  if (!data.ok || !data.liveRun) {
    return {
      ok: false,
      error: data.error ?? data.blockers?.join(" ") ?? res.error ?? "Live canary blocked.",
      blockers: data.blockers,
      liveRun: data.liveRun,
    };
  }
  return {
    ok: true,
    liveRun: data.liveRun,
    contactIdGhl: data.contactIdGhl ?? data.liveRun.contactIdGhl,
    opportunityIdGhl: data.opportunityIdGhl ?? data.liveRun.opportunityIdGhl,
    workflowStarted: data.workflowStarted ?? false,
    externalCallExecuted: data.externalCallExecuted ?? false,
    safetyMessage: data.safetyMessage ?? "",
  };
}
