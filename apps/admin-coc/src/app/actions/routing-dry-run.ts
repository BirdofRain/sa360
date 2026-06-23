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
  isNeedsMappingNotAutoApplicable,
  needsMappingNotAutoApplicableError,
  sanitizeApplySuggestionRow,
} from "@/lib/routing-dry-run/routing-dry-run-apply-suggestion";
import { logApplySuggestionAction } from "@/lib/routing-dry-run/routing-dry-run-apply-suggestion-log";
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
  const trimmedId = decisionId?.trim() ?? "";

  function logResult(
    safeRow: RoutingDryRunDecisionItem | undefined,
    resultCode: string,
    error?: string
  ) {
    logApplySuggestionAction({
      decisionId: trimmedId || safeRow?.id || "unknown",
      matched: safeRow?.matched ?? false,
      matchedRuleId: safeRow?.matchedRuleId ?? null,
      suggestedValidationStatus:
        safeRow?.suggestedValidation?.suggestedValidationStatus ?? null,
      routingEventNameInternal: safeRow?.routingEventNameInternal ?? "unknown",
      destinationClientAccountId: safeRow?.destinationClientAccountId ?? null,
      destinationSubaccountIdGhl: safeRow?.destinationSubaccountIdGhl ?? null,
      resultCode,
      error,
    });
  }

  try {
    if (!row) {
      logResult(undefined, "missing_context");
      return {
        ok: false,
        error: routingDryRunActionError(
          "missing_context",
          "Decision context required to apply suggestion."
        ),
      };
    }

    const safeRow = sanitizeApplySuggestionRow(
      row as RoutingDryRunDecisionItem & { rowPresentable?: boolean }
    );

    if (!trimmedId) {
      logResult(safeRow, "missing_decision_id");
      return {
        ok: false,
        error: routingDryRunActionError("missing_decision_id", "Missing decision id."),
      };
    }

    if (isNeedsMappingNotAutoApplicable(safeRow)) {
      const blocked = needsMappingNotAutoApplicableError();
      logResult(safeRow, blocked.code);
      return {
        ok: false,
        error: routingDryRunActionError(blocked.code, blocked.message, blocked.details),
      };
    }

    let eligibility;
    try {
      eligibility = evaluateApplySuggestionEligibility(safeRow);
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err);
      logResult(safeRow, "invalid_context", details);
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
      logResult(safeRow, eligibility.code, eligibility.details);
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
    if (!result.ok) {
      logResult(safeRow, result.error.code, result.error.details);
      return result;
    }

    let item: RoutingDryRunDecisionItem;
    try {
      item = normalizeRoutingDryRunDecisionItem(
        JSON.parse(JSON.stringify(result.item)) as RoutingDryRunDecisionItem
      );
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err);
      logResult(safeRow, "serialize_failed", details);
      return {
        ok: false,
        error: routingDryRunActionError(
          "serialize_failed",
          "Apply suggestion succeeded but the decision could not be serialized for display.",
          details
        ),
      };
    }

    logResult(safeRow, "ok");
    return {
      ok: true,
      item,
      message: applySuggestionSuccessMessage(safeRow, eligibility.patch),
    };
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    logResult(row, "APPLY_SUGGESTION_FAILED", details);
    return {
      ok: false,
      error: routingDryRunActionError(
        "APPLY_SUGGESTION_FAILED",
        "Apply suggestion failed. Check server logs.",
        details
      ),
    };
  }
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
