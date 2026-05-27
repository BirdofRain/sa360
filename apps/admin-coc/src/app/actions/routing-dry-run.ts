"use server";

import {
  fetchAdminDeliveryPlanForDecision,
  patchAdminRoutingDryRunValidation,
  postAdminDeliveryPlanForDecision,
  postAdminRoutingDryRun,
} from "@/lib/admin-api/server";
import { parseRoutingDryRunTestJson } from "@/lib/routing-dry-run/routing-dry-run-test.util";
import type {
  LeadDeliveryPlanItem,
  RoutingDryRunDecisionItem,
  RoutingDryRunTestResponse,
  RoutingDryRunValidationPatchBody,
} from "@/lib/routing-dry-run/types";

export type RunRoutingDryRunTestActionResult =
  | { ok: true; data: RoutingDryRunTestResponse }
  | { ok: false; error: string };

export async function runRoutingDryRunTestAction(
  rawJson: string
): Promise<RunRoutingDryRunTestActionResult> {
  const parsed = parseRoutingDryRunTestJson(rawJson);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const res = await postAdminRoutingDryRun(parsed.payload);
  if (!res.data || res.error) {
    return { ok: false, error: res.error ?? "Dry-run request failed." };
  }
  return { ok: true, data: res.data };
}

export type UpdateRoutingDryRunValidationActionResult =
  | { ok: true; item: RoutingDryRunDecisionItem }
  | { ok: false; error: string };

export async function updateRoutingDryRunValidationAction(
  decisionId: string,
  body: RoutingDryRunValidationPatchBody
): Promise<UpdateRoutingDryRunValidationActionResult> {
  const res = await patchAdminRoutingDryRunValidation(decisionId, body);
  if (!res.data?.item || res.error) {
    return { ok: false, error: res.error ?? "Validation update failed." };
  }
  return { ok: true, item: res.data.item };
}

export type GenerateDeliveryPlanActionResult =
  | { ok: true; plan: LeadDeliveryPlanItem }
  | { ok: false; error: string };

export async function generateDeliveryPlanAction(
  decisionId: string
): Promise<GenerateDeliveryPlanActionResult> {
  const res = await postAdminDeliveryPlanForDecision(decisionId);
  if (!res.plan || res.error) {
    return { ok: false, error: res.error ?? "Failed to generate delivery plan." };
  }
  return { ok: true, plan: res.plan };
}

export async function loadDeliveryPlanForDecisionAction(
  decisionId: string
): Promise<{ plan: LeadDeliveryPlanItem | null; error: string | null }> {
  return fetchAdminDeliveryPlanForDecision(decisionId);
}
