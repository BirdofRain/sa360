import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCEPT_PREDICTED_LEGACY_NOTE,
  buildAcceptPredictedDestinationPatch,
  hasPredictedDestination,
} from "./routing-dry-run-validation-patch.ts";
import {
  acceptPredictedDestinationLabel,
  isExpectedMatchSource,
} from "./routing-dry-run-validation-display.ts";
import type { RoutingDryRunDecisionItem } from "./types.ts";

function row(overrides: Partial<RoutingDryRunDecisionItem> = {}): RoutingDryRunDecisionItem {
  return {
    id: "dec_1",
    createdAt: "2026-06-29T00:00:00.000Z",
    sourceEventUuid: "evt_1",
    sourceLeadUid: "google-sheet-google_sheet_import-abc",
    matched: true,
    confidence: "high",
    matchType: "campaign_id",
    matchedRuleId: "rule_1",
    matchedRuleSummary: null,
    destinationClientAccountId: "client_demo",
    destinationSubaccountIdGhl: "loc_demo",
    reason: "Matched routing rule (campaign_id)",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    attributionSnapshot: { sourcePlatform: "google_sheets", sourceType: "google_sheet_import" },
    lifecycleEventsEmitted: [],
    leadIdentity: null,
    masterClientAccountId: "lal_master_vet",
    deliveryPlanSummary: null,
    suggestedValidation: {
      suggestedValidationStatus: "matched_legacy",
      suggestedValidationReason: "",
      suggestionConfidence: "high",
    },
    suggestedLegacyPrefill: {
      legacyDeliveredClientAccountId: null,
      legacyDeliveredSubaccountIdGhl: null,
      legacyDeliveryContactIdGhl: null,
      legacyDeliveryStatus: null,
      prefillReason: null,
      prefillConfidence: null,
    },
    deliveryReadiness: null,
    duplicateRisk: null,
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: "existing_contact",
    legacyDeliveryStatus: "delivered",
    validationStatus: null,
    validationNotes: null,
    validatedAt: null,
    validatedBy: null,
    ...overrides,
  };
}

test("hasPredictedDestination requires both client and subaccount", () => {
  assert.equal(hasPredictedDestination(row()), true);
  assert.equal(hasPredictedDestination(row({ destinationClientAccountId: null })), false);
  assert.equal(hasPredictedDestination(row({ destinationSubaccountIdGhl: "  " })), false);
});

test("buildAcceptPredictedDestinationPatch prefills predicted destination as matched_legacy", () => {
  const patch = buildAcceptPredictedDestinationPatch(row());
  assert.ok(patch);
  assert.equal(patch.validationStatus, "matched_legacy");
  assert.equal(patch.legacyDeliveredClientAccountId, "client_demo");
  assert.equal(patch.legacyDeliveredSubaccountIdGhl, "loc_demo");
  assert.equal(patch.validationNotes, ACCEPT_PREDICTED_LEGACY_NOTE);
  // Real legacy verification fields are preserved (left editable for Zapier/GHL).
  assert.equal(patch.legacyDeliveryContactIdGhl, "existing_contact");
  assert.equal(patch.legacyDeliveryStatus, "delivered");
});

test("buildAcceptPredictedDestinationPatch returns null without a predicted destination", () => {
  assert.equal(buildAcceptPredictedDestinationPatch(row({ destinationClientAccountId: null })), null);
  assert.equal(buildAcceptPredictedDestinationPatch(row({ destinationSubaccountIdGhl: null })), null);
});

test("Google Sheet / cutover sources are framed as expected legacy/demo match", () => {
  assert.equal(isExpectedMatchSource(row()), true);
  assert.equal(
    acceptPredictedDestinationLabel(row()),
    "Use SA360 predicted destination as expected legacy/demo match"
  );
});

test("non-shadow sources keep actual legacy framing", () => {
  const fb = row({
    sourceLeadUid: "facebook-meta_lead_ads-123",
    attributionSnapshot: { sourcePlatform: "facebook", sourceType: "facebook_lead_form" },
  });
  assert.equal(isExpectedMatchSource(fb), false);
  assert.equal(
    acceptPredictedDestinationLabel(fb),
    "Use SA360 predicted destination as expected legacy match"
  );
});
