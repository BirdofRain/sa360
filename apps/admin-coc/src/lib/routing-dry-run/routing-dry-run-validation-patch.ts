import type { RoutingDryRunDecisionItem, RoutingDryRunValidationPatchBody } from "./types.ts";

/** PATCH body to mark a row as matched with current legacy field values. */
export function buildMatchedLegacyValidationPatch(
  row: RoutingDryRunDecisionItem
): RoutingDryRunValidationPatchBody {
  return {
    validationStatus: "matched_legacy",
    legacyDeliveredClientAccountId: row.legacyDeliveredClientAccountId,
    legacyDeliveredSubaccountIdGhl: row.legacyDeliveredSubaccountIdGhl,
    legacyDeliveryContactIdGhl: row.legacyDeliveryContactIdGhl,
    legacyDeliveryStatus: row.legacyDeliveryStatus,
    validationNotes: row.validationNotes,
    validatedBy: row.validatedBy ?? undefined,
  };
}

export const ACCEPT_PREDICTED_LEGACY_NOTE =
  "Operator accepted SA360 predicted destination as expected legacy/demo destination.";

function trimmed(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** True when SA360 predicted both a destination client and GHL subaccount for this decision. */
export function hasPredictedDestination(
  row: Pick<RoutingDryRunDecisionItem, "destinationClientAccountId" | "destinationSubaccountIdGhl">
): boolean {
  return Boolean(
    trimmed(row.destinationClientAccountId) && trimmed(row.destinationSubaccountIdGhl)
  );
}

/**
 * PATCH body that accepts the SA360-predicted destination as the expected legacy/demo match.
 *
 * Prefills the legacy delivered client/subaccount from the routing prediction and marks the
 * row matched_legacy. The legacy delivery contact id and status are preserved (left editable
 * for real Zapier/GHL verification). Returns null when no predicted destination exists.
 * This never triggers delivery or GHL writes — it only records an operator review decision.
 */
export function buildAcceptPredictedDestinationPatch(
  row: RoutingDryRunDecisionItem
): RoutingDryRunValidationPatchBody | null {
  const client = trimmed(row.destinationClientAccountId);
  const subaccount = trimmed(row.destinationSubaccountIdGhl);
  if (!client || !subaccount) return null;
  return {
    validationStatus: "matched_legacy",
    legacyDeliveredClientAccountId: client,
    legacyDeliveredSubaccountIdGhl: subaccount,
    // Preserve any real legacy verification fields the operator already captured.
    legacyDeliveryContactIdGhl: row.legacyDeliveryContactIdGhl,
    legacyDeliveryStatus: row.legacyDeliveryStatus,
    validationNotes: ACCEPT_PREDICTED_LEGACY_NOTE,
    validatedBy: row.validatedBy ?? undefined,
  };
}
