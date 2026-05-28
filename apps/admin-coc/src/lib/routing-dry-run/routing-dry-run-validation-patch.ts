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
