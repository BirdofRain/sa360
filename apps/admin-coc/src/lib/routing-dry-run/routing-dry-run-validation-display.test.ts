import test from "node:test";
import assert from "node:assert/strict";
import type { RoutingDryRunDecisionItem } from "./types";
import {
  effectiveValidationStatus,
  validationStatusBadgeClass,
  validationStatusLabel,
} from "./routing-dry-run-validation-display.ts";

function row(partial: Partial<RoutingDryRunDecisionItem>): RoutingDryRunDecisionItem {
  return {
    id: "d1",
    createdAt: "2026-05-19T12:00:00.000Z",
    sourceEventUuid: null,
    sourceLeadUid: "lead_1",
    matched: true,
    confidence: "high",
    matchType: "campaign_id",
    matchedRuleId: "rule_1",
    matchedRuleSummary: null,
    destinationClientAccountId: "client_a",
    destinationSubaccountIdGhl: "loc_a",
    reason: "ok",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    attributionSnapshot: null,
    lifecycleEventsEmitted: [],
    leadIdentity: null,
    masterClientAccountId: "master_1",
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    validationStatus: null,
    validationNotes: null,
    validatedAt: null,
    validatedBy: null,
    deliveryPlanSummary: null,
    ...partial,
  };
}

test("effectiveValidationStatus treats null as unreviewed", () => {
  assert.equal(effectiveValidationStatus(null), "unreviewed");
});

test("validationStatusLabel renders matched legacy", () => {
  assert.equal(validationStatusLabel("matched_legacy"), "Matched legacy");
});

test("validationStatusBadgeClass uses green for matched_legacy", () => {
  assert.ok(validationStatusBadgeClass("matched_legacy").includes("emerald"));
  assert.ok(validationStatusBadgeClass("mismatch").includes("red"));
});

test("table row with mismatch status label", () => {
  const label = validationStatusLabel(row({ validationStatus: "mismatch" }).validationStatus);
  assert.equal(label, "Mismatch");
});
