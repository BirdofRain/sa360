import type { RoutingDryRunDecisionItem } from "./types.ts";
import { effectiveValidationStatus } from "./routing-dry-run-validation-display.ts";

export type RoutingDryRunPageStats = {
  matchedPredictions: number;
  reviewRequired: number;
  validatedMatchedLegacy: number;
  mismatches: number;
  needsMapping: number;
};

/** Counts for the current loaded page (not global totals). */
export function computeRoutingDryRunPageStats(
  items: RoutingDryRunDecisionItem[]
): RoutingDryRunPageStats {
  let matchedPredictions = 0;
  let reviewRequired = 0;
  let validatedMatchedLegacy = 0;
  let mismatches = 0;
  let needsMapping = 0;

  for (const row of items) {
    if (row.matched) matchedPredictions += 1;
    else reviewRequired += 1;

    const status = effectiveValidationStatus(row.validationStatus);
    if (status === "matched_legacy") validatedMatchedLegacy += 1;
    if (status === "mismatch") mismatches += 1;
    if (status === "needs_mapping") needsMapping += 1;
  }

  return {
    matchedPredictions,
    reviewRequired,
    validatedMatchedLegacy,
    mismatches,
    needsMapping,
  };
}
