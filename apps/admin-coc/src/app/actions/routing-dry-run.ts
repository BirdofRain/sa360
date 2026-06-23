"use server";

import type {
  DuplicateRiskAssessmentItem,
  DuplicateRiskReviewPatchBody,
} from "@/lib/routing-dry-run/duplicate-risk-types";
import {
  formatRoutingDryRunActionError,
  routingDryRunActionError,
  runRoutingDryRunAction,
  type RoutingDryRunActionError,
} from "@/lib/routing-dry-run/routing-dry-run-action.util";
import { getDeliveryPlanEligibility } from "@/lib/routing-dry-run/routing-dry-run-plan-eligibility";
import {
  normalizeRoutingDryRunDecisionItem,
  ROUTING_DRY_RUN_ACTION_FAILED,
} from "@/lib/routing-dry-run/routing-dry-run-safe";
import {
  fetchAdminDeliveryPlanForDecision,
  patchAdminDuplicateRiskReview,
  patchAdminRoutingDryRunValidation,
  postAdminDeliveryPlanForDecision,
  postAdminRoutingDryRun,
} from "@/lib/admin-api/server";
import {
  applySuggestionSuccessMessage,
  evaluateApplySuggestionEligibility,
} from "@/lib/routing-dry-run/routing-dry-run-apply-suggestion";
import { parseRoutingDryRunTestJson } from "@/lib/routing-dry-run/routing-dry-run-test.util";
import type {
  LeadDeliveryPlanItem,
  RoutingDryRunDecisionItem,
  RoutingDryRunTestResponse,
  RoutingDryRunValidationPatchBody,
} from "@/lib/routing-dry-run/types";

export type { RoutingDryRunActionError };

export type RunRoutingDryRunTestActionResult =
  | { ok: true; data: RoutingDryRunTestResponse }
  | { ok: false; error: RoutingDryRunActionError };

export async function runRoutingDryRunTestAction(
  rawJson: string
): Promise<RunRoutingDryRunTestActionResult> {
  const parsed = parseRoutingDryRunTestJson(rawJson);
  if (!parsed.ok) {
    return { ok: false, error: routingDryRunActionError("invalid_payload", parsed.error) };
  }

  const wrapped = await runRoutingDryRunAction(async () => {
    const res = await postAdminRoutingDryRun(parsed.payload);
    if (!res.data || res.error) {
      throw new Error(res.error ?? ROUTING_DRY_RUN_ACTION_FAILED);
    }
    return res.data;
  });
  if (!wrapped.ok) return { ok: false, error: wrapped.error };
  return { ok: true, data: wrapped.data };
}

export type UpdateRoutingDryRunValidationActionResult =
  | { ok: true; item: RoutingDryRunDecisionItem }
  | { ok: false; error: RoutingDryRunActionError };

export async function updateRoutingDryRunValidationAction(
  decisionId: string,
  body: RoutingDryRunValidationPatchBody
): Promise<UpdateRoutingDryRunValidationActionResult> {
  const wrapped = await runRoutingDryRunAction(async () => {
    const res = await patchAdminRoutingDryRunValidation(decisionId, body);
    if (!res.data?.item || res.error) {
      throw new Error(res.error ?? ROUTING_DRY_RUN_ACTION_FAILED);
    }
    return normalizeRoutingDryRunDecisionItem(res.data.item);
  });
  if (!wrapped.ok) return { ok: false, error: wrapped.error };
  return { ok: true, item: wrapped.data };
}

export type ApplyRoutingSuggestionActionResult =
  | { ok: true; item: RoutingDryRunDecisionItem; message?: string }
  | { ok: false; error: RoutingDryRunActionError };

export async function applyRoutingSuggestionAction(
  decisionId: string,
  row?: RoutingDryRunDecisionItem
): Promise<ApplyRoutingSuggestionActionResult> {
  if (!row) {
    return {
      ok: false,
      error: routingDryRunActionError(
        "missing_context",
        "Decision context required to apply suggestion."
      ),
    };
  }

  const trimmedId = decisionId.trim();
  if (!trimmedId) {
    return {
      ok: false,
      error: routingDryRunActionError("missing_decision_id", "Missing decision id."),
    };
  }

  let eligibility;
  try {
    eligibility = evaluateApplySuggestionEligibility(row);
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: routingDryRunActionError(
        "invalid_context",
        "Could not evaluate suggestion for this decision.",
        details
      ),
    };
  }

  if (!eligibility.allowed) {
    return {
      ok: false,
      error: routingDryRunActionError(
        eligibility.code,
        eligibility.message,
        eligibility.details
      ),
    };
  }

  const result = await updateRoutingDryRunValidationAction(trimmedId, eligibility.patch);
  if (!result.ok) return result;

  return {
    ok: true,
    item: result.item,
    message: applySuggestionSuccessMessage(row, eligibility.patch),
  };
}

export type GenerateDeliveryPlanActionResult =
  | { ok: true; plan: LeadDeliveryPlanItem }
  | { ok: false; error: RoutingDryRunActionError };

export async function generateDeliveryPlanAction(
  decisionId: string,
  row?: RoutingDryRunDecisionItem
): Promise<GenerateDeliveryPlanActionResult> {
  if (row) {
    const eligibility = getDeliveryPlanEligibility(row);
    if (!eligibility.allowed) {
      return {
        ok: false,
        error: routingDryRunActionError(
          "plan_not_eligible",
          eligibility.message ?? ROUTING_DRY_RUN_ACTION_FAILED
        ),
      };
    }
  }

  const wrapped = await runRoutingDryRunAction(async () => {
    const res = await postAdminDeliveryPlanForDecision(decisionId);
    if (!res.plan || res.error) {
      throw new Error(res.error ?? ROUTING_DRY_RUN_ACTION_FAILED);
    }
    return res.plan;
  });
  if (!wrapped.ok) return { ok: false, error: wrapped.error };
  return { ok: true, plan: wrapped.data };
}

export type LoadDeliveryPlanActionResult =
  | { ok: true; plan: LeadDeliveryPlanItem }
  | { ok: false; error: RoutingDryRunActionError; plan: null };

export async function loadDeliveryPlanForDecisionAction(
  decisionId: string
): Promise<LoadDeliveryPlanActionResult> {
  const wrapped = await runRoutingDryRunAction(async () => {
    const res = await fetchAdminDeliveryPlanForDecision(decisionId);
    if (res.error) throw new Error(res.error);
    if (!res.plan) throw new Error("No delivery plan exists yet for this decision.");
    return res.plan;
  });
  if (!wrapped.ok) {
    return { ok: false, error: wrapped.error, plan: null };
  }
  return { ok: true, plan: wrapped.data };
}

export type PatchDuplicateRiskReviewActionResult =
  | { ok: true; duplicateRisk: DuplicateRiskAssessmentItem }
  | { ok: false; error: RoutingDryRunActionError };

export async function patchDuplicateRiskReviewAction(
  decisionId: string,
  body: DuplicateRiskReviewPatchBody
): Promise<PatchDuplicateRiskReviewActionResult> {
  const wrapped = await runRoutingDryRunAction(async () => {
    const res = await patchAdminDuplicateRiskReview(decisionId, body);
    if (!res.data?.duplicateRisk || res.error) {
      throw new Error(res.error ?? ROUTING_DRY_RUN_ACTION_FAILED);
    }
    return res.data.duplicateRisk;
  });
  if (!wrapped.ok) return { ok: false, error: wrapped.error };
  return { ok: true, duplicateRisk: wrapped.data };
}

/** @deprecated Use formatRoutingDryRunActionError from action util */
export { formatRoutingDryRunActionError };
