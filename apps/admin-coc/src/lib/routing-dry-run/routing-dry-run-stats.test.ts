import test from "node:test";
import assert from "node:assert/strict";
import type { RoutingDryRunDecisionItem } from "./types";
import { computeRoutingDryRunPageStats } from "./routing-dry-run-stats.ts";

function row(
  partial: Pick<RoutingDryRunDecisionItem, "matched" | "validationStatus">
): RoutingDryRunDecisionItem {
  return {
    id: "d1",
    createdAt: "2026-05-19T12:00:00.000Z",
    sourceEventUuid: null,
    sourceLeadUid: "lead_1",
    matched: partial.matched,
    confidence: "high",
    matchType: null,
    matchedRuleId: null,
    matchedRuleSummary: null,
    destinationClientAccountId: null,
    destinationSubaccountIdGhl: null,
    reason: "",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    attributionSnapshot: null,
    lifecycleEventsEmitted: [],
    leadIdentity: null,
    masterClientAccountId: "master_1",
    deliveryPlanSummary: null,
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    validationStatus: partial.validationStatus,
    validationNotes: null,
    validatedAt: null,
    validatedBy: null,
  };
}

test("computeRoutingDryRunPageStats counts matched review and validation buckets", () => {
  const stats = computeRoutingDryRunPageStats([
    row({ matched: true, validationStatus: "matched_legacy" }),
    row({ matched: true, validationStatus: "mismatch" }),
    row({ matched: false, validationStatus: "needs_mapping" }),
    row({ matched: true, validationStatus: null }),
  ]);
  assert.equal(stats.matchedPredictions, 3);
  assert.equal(stats.reviewRequired, 1);
  assert.equal(stats.validatedMatchedLegacy, 1);
  assert.equal(stats.mismatches, 1);
  assert.equal(stats.needsMapping, 1);
});
