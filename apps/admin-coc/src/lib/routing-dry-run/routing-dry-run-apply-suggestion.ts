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

export type ApplySuggestionEligibility =
  | { allowed: true; patch: RoutingDryRunValidationPatchBody }
  | { allowed: false; code: string; message: string; details?: string };

function coalesce(
  current: string | null | undefined,
  suggested: string | null | undefined
): string | null {
  const c = current?.trim();
  if (c) return c;
  const s = suggested?.trim();
  return s ? s : null;
}

function resolveSuggestion(row: RoutingDryRunDecisionItem) {
  return row.suggestedValidation ?? defaultRoutingValidationSuggestion;
}

function resolveLegacyPrefill(row: RoutingDryRunDecisionItem) {
  return row.suggestedLegacyPrefill ?? emptyLegacyPrefillSuggestion;
}

/** Whether this suggestion can be applied without matched routing / delivery config. */
export function evaluateApplySuggestionEligibility(
  row: RoutingDryRunDecisionItem
): ApplySuggestionEligibility {
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
    return {
      allowed: false,
      code: "NEEDS_MAPPING_NOT_AUTO_APPLICABLE",
      message:
        "This suggestion cannot be auto-applied because no active routing rule matched. Create or update a routing rule first.",
    };
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
  if (!row.matched && patch.validationStatus === "needs_mapping") {
    return "Validation marked as needs mapping. Add or update a routing rule before generating a delivery plan.";
  }
  if (patch.validationStatus === "legacy_unknown") {
    return "Validation marked as legacy unknown. Delivery plan remains unavailable until routing is matched.";
  }
  return undefined;
}
