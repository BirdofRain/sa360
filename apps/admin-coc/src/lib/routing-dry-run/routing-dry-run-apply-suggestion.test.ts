import test from "node:test";
import assert from "node:assert/strict";
import {
  applySuggestionSuccessMessage,
  buildApplySuggestionPatch,
  evaluateApplySuggestionEligibility,
} from "./routing-dry-run-apply-suggestion.ts";
import { routingDryRunDecisionFixture } from "./routing-dry-run-suggestion-fixture.ts";

test("buildApplySuggestionPatch uses suggestion status without overwriting filled legacy fields", () => {
  const patch = buildApplySuggestionPatch(
    routingDryRunDecisionFixture({
      legacyDeliveredSubaccountIdGhl: "loc_manual",
      suggestedValidation: {
        suggestedValidationStatus: "matched_legacy",
        suggestedValidationReason: "Subaccounts match",
        suggestionConfidence: "high",
      },
      suggestedLegacyPrefill: {
        legacyDeliveredClientAccountId: "client_prefill",
        legacyDeliveredSubaccountIdGhl: "loc_prefill",
        legacyDeliveryContactIdGhl: null,
        legacyDeliveryStatus: null,
        prefillReason: "From event",
        prefillConfidence: "high",
      },
    })
  );
  assert.equal(patch.validationStatus, "matched_legacy");
  assert.equal(patch.legacyDeliveredSubaccountIdGhl, "loc_manual");
  assert.equal(patch.legacyDeliveredClientAccountId, "client_prefill");
});

test("buildApplySuggestionPatch tolerates missing suggestion and prefill objects", () => {
  const row = routingDryRunDecisionFixture({
    suggestedValidation: undefined as unknown as never,
    suggestedLegacyPrefill: undefined as unknown as never,
  });
  const patch = buildApplySuggestionPatch(row);
  assert.equal(patch.validationStatus, "legacy_unknown");
  assert.match(patch.validationNotes ?? "", /Auto-applied suggestion/i);
});

test("evaluateApplySuggestionEligibility allows needs_mapping on unmatched decisions", () => {
  const row = routingDryRunDecisionFixture({
    matched: false,
    matchedRuleId: null,
    destinationClientAccountId: null,
    routingEventNameInternal: "routing_review_required",
    suggestedValidation: {
      suggestedValidationStatus: "needs_mapping",
      suggestedValidationReason: "No active routing rule matched attribution; manual review required",
      suggestionConfidence: "high",
    },
  });
  const eligibility = evaluateApplySuggestionEligibility(row);
  assert.equal(eligibility.allowed, true);
  if (eligibility.allowed) {
    assert.equal(eligibility.patch.validationStatus, "needs_mapping");
  }
});

test("evaluateApplySuggestionEligibility blocks matched_legacy when unmatched", () => {
  const row = routingDryRunDecisionFixture({
    matched: false,
    suggestedValidation: {
      suggestedValidationStatus: "matched_legacy",
      suggestedValidationReason: "Would require a matched rule",
      suggestionConfidence: "high",
    },
  });
  const eligibility = evaluateApplySuggestionEligibility(row);
  assert.equal(eligibility.allowed, false);
  if (!eligibility.allowed) {
    assert.equal(eligibility.code, "NEEDS_MAPPING_NOT_AUTO_APPLICABLE");
  }
});

test("evaluateApplySuggestionEligibility allows legacy_unknown without matched rule", () => {
  const row = routingDryRunDecisionFixture({
    matched: false,
    suggestedValidation: {
      suggestedValidationStatus: "legacy_unknown",
      suggestedValidationReason: "No legacy delivery fields recorded yet",
      suggestionConfidence: "medium",
    },
  });
  const eligibility = evaluateApplySuggestionEligibility(row);
  assert.equal(eligibility.allowed, true);
});

test("applySuggestionSuccessMessage explains needs_mapping on unmatched decisions", () => {
  const row = routingDryRunDecisionFixture({ matched: false });
  const message = applySuggestionSuccessMessage(row, { validationStatus: "needs_mapping" });
  assert.match(message ?? "", /routing rule/i);
});
