import type { RoutingDryRunDecisionItem, RoutingDryRunValidationPatchBody } from "./types.ts";

function coalesce(
  current: string | null | undefined,
  suggested: string | null | undefined
): string | null {
  const c = current?.trim();
  if (c) return c;
  const s = suggested?.trim();
  return s ? s : null;
}

/** PATCH body applying auto-suggest status and optional legacy prefill (does not overwrite filled legacy fields). */
export function buildApplySuggestionPatch(
  row: RoutingDryRunDecisionItem
): RoutingDryRunValidationPatchBody {
  const s = row.suggestedValidation;
  const p = row.suggestedLegacyPrefill;
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
      : `Auto-applied suggestion: ${s.suggestedValidationReason}`,
    validatedBy: row.validatedBy ?? undefined,
  };
}
