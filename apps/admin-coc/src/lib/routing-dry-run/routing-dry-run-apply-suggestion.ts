import { defaultRoutingValidationSuggestion, emptyLegacyPrefillSuggestion } from "./routing-dry-run-suggestion-fixture.ts";
import type { RoutingDryRunDecisionItem, RoutingDryRunValidationPatchBody } from "./types.ts";

const APPLY_VALIDATION_STATUSES = new Set([
  "unreviewed",
  "matched_legacy",
  "mismatch",
  "needs_mapping",
  "ignored_test",
  "legacy_unknown",
]);

export const NEEDS_MAPPING_NOT_AUTO_APPLICABLE_MESSAGE =
  "This suggestion cannot be auto-applied because no active routing rule matched. Create or update a routing rule first.";

export type ApplySuggestionEligibility =
  | { allowed: true; patch: RoutingDryRunValidationPatchBody }
  | { allowed: false; code: string; message: string; details?: string };

export type ApplySuggestionDecisionContext = Pick<
  RoutingDryRunDecisionItem,
  | "matched"
  | "matchedRuleId"
  | "routingEventNameInternal"
  | "destinationClientAccountId"
  | "destinationSubaccountIdGhl"
  | "suggestedValidation"
>;

function coalesce(
  current: string | null | undefined,
  suggested: string | null | undefined
): string | null {
  const c = current?.trim();
  if (c) return c;
  const s = suggested?.trim();
  return s ? s : null;
}

function resolveSuggestion(row: ApplySuggestionDecisionContext) {
  return row.suggestedValidation ?? defaultRoutingValidationSuggestion;
}

function resolveLegacyPrefill(row: RoutingDryRunDecisionItem) {
  return row.suggestedLegacyPrefill ?? emptyLegacyPrefillSuggestion;
}

/**
 * First-line guard: unmatched / review-required / needs_mapping decisions cannot be
 * auto-applied (no validation PATCH, no legacy prefill, no delivery plan work).
 */
export function isNeedsMappingNotAutoApplicable(row: ApplySuggestionDecisionContext): boolean {
  const suggestion = resolveSuggestion(row);
  if (row.matched !== true) return true;
  if (!row.matchedRuleId?.trim()) return true;
  if (suggestion.suggestedValidationStatus?.trim() === "needs_mapping") return true;
  if (row.routingEventNameInternal === "routing_review_required") return true;
  if (!row.destinationClientAccountId?.trim()) return true;
  if (!row.destinationSubaccountIdGhl?.trim()) return true;
  return false;
}

export function needsMappingNotAutoApplicableError(): Extract<
  ApplySuggestionEligibility,
  { allowed: false }
> {
  return {
    allowed: false,
    code: "NEEDS_MAPPING_NOT_AUTO_APPLICABLE",
    message: NEEDS_MAPPING_NOT_AUTO_APPLICABLE_MESSAGE,
  };
}

/** Strip client-only fields before server action handling. */
export function sanitizeApplySuggestionRow(
  row: RoutingDryRunDecisionItem & { rowPresentable?: boolean }
): RoutingDryRunDecisionItem {
  try {
    return JSON.parse(JSON.stringify(row)) as RoutingDryRunDecisionItem;
  } catch {
    const { rowPresentable: _rowPresentable, ...rest } = row;
    void _rowPresentable;
    return rest;
  }
}

/** Whether this suggestion can be applied without matched routing / delivery config. */
export function evaluateApplySuggestionEligibility(
  row: RoutingDryRunDecisionItem
): ApplySuggestionEligibility {
  if (isNeedsMappingNotAutoApplicable(row)) {
    return needsMappingNotAutoApplicableError();
  }

  const suggestion = resolveSuggestion(row);
  const status = suggestion.suggestedValidationStatus?.trim();
  if (!status || !APPLY_VALIDATION_STATUSES.has(status)) {
    return {
      allowed: false,
      code: "missing_suggestion",
      message: "No applicable validation suggestion is available for this decision.",
      details: status ? `Unsupported status: ${status}` : undefined,
    };
  }

  if ((status === "matched_legacy" || status === "mismatch") && !row.matched) {
    return needsMappingNotAutoApplicableError();
  }

  if (
    status === "matched_legacy" &&
    !row.matchedRuleId &&
    !row.destinationClientAccountId?.trim()
  ) {
    return {
      allowed: false,
      code: "no_destination",
      message:
        "Matched-legacy suggestion requires a SA360 destination client. Map a routing rule before applying.",
    };
  }

  return { allowed: true, patch: buildApplySuggestionPatch(row) };
}

/** PATCH body applying auto-suggest status and optional legacy prefill (does not overwrite filled legacy fields). */
export function buildApplySuggestionPatch(
  row: RoutingDryRunDecisionItem
): RoutingDryRunValidationPatchBody {
  const s = resolveSuggestion(row);
  const p = resolveLegacyPrefill(row);
  const reason = s.suggestedValidationReason?.trim() || "Operator suggestion";
  return {
    validationStatus: s.suggestedValidationStatus,
    legacyDeliveredClientAccountId: coalesce(
      row.legacyDeliveredClientAccountId,
      p.legacyDeliveredClientAccountId
    ),
    legacyDeliveredSubaccountIdGhl: coalesce(
      row.legacyDeliveredSubaccountIdGhl,
      p.legacyDeliveredSubaccountIdGhl
    ),
    legacyDeliveryContactIdGhl: coalesce(
      row.legacyDeliveryContactIdGhl,
      p.legacyDeliveryContactIdGhl
    ),
    legacyDeliveryStatus: coalesce(row.legacyDeliveryStatus, p.legacyDeliveryStatus),
    validationNotes: row.validationNotes?.trim()
      ? row.validationNotes
      : `Auto-applied suggestion: ${reason}`,
    validatedBy: row.validatedBy ?? undefined,
  };
}

export function applySuggestionSuccessMessage(
  row: RoutingDryRunDecisionItem,
  patch: RoutingDryRunValidationPatchBody
): string | undefined {
  if (patch.validationStatus === "legacy_unknown") {
    return "Validation marked as legacy unknown. Delivery plan remains unavailable until routing is matched.";
  }
  return undefined;
}

/** Mike/Darryl-style unmatched needs_mapping fixture for tests. */
export function unmatchedNeedsMappingDecisionFixture(): RoutingDryRunDecisionItem {
  return {
    id: "cmqqpz7pe001nkc0us0srmmqa",
    createdAt: "2026-06-23T12:00:00.000Z",
    sourceEventUuid: null,
    sourceLeadUid: "cPIry69HLJ186qQjT4oK",
    matched: false,
    confidence: "none",
    matchType: null,
    matchedRuleId: null,
    matchedRuleSummary: null,
    destinationClientAccountId: null,
    destinationSubaccountIdGhl: null,
    reason: "No active routing rule matched attribution; manual review required",
    deliveryMode: "dry_run",
    routingEventNameInternal: "routing_review_required",
    attributionSnapshot: {
      nicheKey: "VET",
      sourceType: "facebook_lead_form",
      campaignName: "Master Vet Pixel",
      sourcePlatform: "facebook",
      masterDatasetId: "943556280266263",
      masterClientAccountId: "lal_master_vet",
    },
    lifecycleEventsEmitted: ["routing_review_required"],
    leadIdentity: {
      contactIdGhl: "GuoviRZYJ5YfEUlb0IwB",
      firstName: "Mike",
      lastName: "Jackson",
      displayName: "Mike Jackson",
      phoneE164: null,
      email: null,
    },
    masterClientAccountId: "lal_master_vet",
    deliveryPlanSummary: null,
    suggestedValidation: {
      suggestedValidationStatus: "needs_mapping",
      suggestedValidationReason:
        "SA360 did not match an active routing rule; legacy comparison requires rule mapping first.",
      suggestionConfidence: "high",
    },
    suggestedLegacyPrefill: {
      legacyDeliveredClientAccountId: null,
      legacyDeliveredSubaccountIdGhl: "lal_master_vet",
      legacyDeliveryContactIdGhl: "GuoviRZYJ5YfEUlb0IwB",
      legacyDeliveryStatus: null,
      prefillReason:
        "Suggested from contact from source lifecycle event; subaccount from source lifecycle event.",
      prefillConfidence: "high",
    },
    deliveryReadiness: null,
    duplicateRisk: null,
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    validationStatus: null,
    validationNotes: null,
    validatedAt: null,
    validatedBy: null,
  };
}
