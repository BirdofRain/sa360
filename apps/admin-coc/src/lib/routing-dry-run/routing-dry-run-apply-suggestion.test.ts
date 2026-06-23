import test from "node:test";
import assert from "node:assert/strict";
import {
  applySuggestionSuccessMessage,
  buildApplySuggestionPatch,
  evaluateApplySuggestionEligibility,
  isNeedsMappingNotAutoApplicable,
  unmatchedNeedsMappingDecisionFixture,
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
    matched: true,
    matchedRuleId: "rule_1",
    destinationClientAccountId: "client_1",
    destinationSubaccountIdGhl: "loc_1",
    routingEventNameInternal: "lead_matched",
    suggestedValidation: undefined as unknown as never,
    suggestedLegacyPrefill: undefined as unknown as never,
  });
  const patch = buildApplySuggestionPatch(row);
  assert.equal(patch.validationStatus, "legacy_unknown");
  assert.match(patch.validationNotes ?? "", /Auto-applied suggestion/i);
});

test("isNeedsMappingNotAutoApplicable is true for Mike-style unmatched needs_mapping payload", () => {
  const row = unmatchedNeedsMappingDecisionFixture();
  assert.equal(isNeedsMappingNotAutoApplicable(row), true);
});

test("evaluateApplySuggestionEligibility blocks unmatched needs_mapping decisions", () => {
  const eligibility = evaluateApplySuggestionEligibility(unmatchedNeedsMappingDecisionFixture());
  assert.equal(eligibility.allowed, false);
  if (!eligibility.allowed) {
    assert.equal(eligibility.code, "NEEDS_MAPPING_NOT_AUTO_APPLICABLE");
  }
});

test("evaluateApplySuggestionEligibility blocks routing_review_required without matched rule", () => {
  const row = routingDryRunDecisionFixture({
    matched: false,
    matchedRuleId: null,
    routingEventNameInternal: "routing_review_required",
    suggestedValidation: {
      suggestedValidationStatus: "legacy_unknown",
      suggestedValidationReason: "No legacy fields",
      suggestionConfidence: "medium",
    },
  });
  assert.equal(evaluateApplySuggestionEligibility(row).allowed, false);
});

test("evaluateApplySuggestionEligibility blocks when matchedRuleId is null", () => {
  const row = routingDryRunDecisionFixture({
    matched: true,
    matchedRuleId: null,
    destinationClientAccountId: "client_1",
    destinationSubaccountIdGhl: "loc_1",
    routingEventNameInternal: "lead_matched",
  });
  assert.equal(evaluateApplySuggestionEligibility(row).allowed, false);
});

test("evaluateApplySuggestionEligibility blocks when destinationClientAccountId is null", () => {
  const row = routingDryRunDecisionFixture({
    matched: true,
    matchedRuleId: "rule_1",
    destinationClientAccountId: null,
    destinationSubaccountIdGhl: "loc_1",
    routingEventNameInternal: "lead_matched",
    suggestedValidation: {
      suggestedValidationStatus: "matched_legacy",
      suggestedValidationReason: "Match",
      suggestionConfidence: "high",
    },
  });
  assert.equal(evaluateApplySuggestionEligibility(row).allowed, false);
});

test("evaluateApplySuggestionEligibility blocks when deliveryReadiness is null on unmatched row", () => {
  const row = unmatchedNeedsMappingDecisionFixture();
  assert.equal(row.deliveryReadiness, null);
  assert.equal(evaluateApplySuggestionEligibility(row).allowed, false);
});

test("evaluateApplySuggestionEligibility allows matched legacy suggestion when routing is complete", () => {
  const row = routingDryRunDecisionFixture({
    matched: true,
    matchedRuleId: "rule_1",
    destinationClientAccountId: "client_1",
    destinationSubaccountIdGhl: "loc_1",
    routingEventNameInternal: "lead_matched",
    suggestedValidation: {
      suggestedValidationStatus: "matched_legacy",
      suggestedValidationReason: "Subaccounts match",
      suggestionConfidence: "high",
    },
    deliveryReadiness: null,
  });
  const eligibility = evaluateApplySuggestionEligibility(row);
  assert.equal(eligibility.allowed, true);
});

test("applySuggestionSuccessMessage does not claim success for blocked needs_mapping", () => {
  const row = unmatchedNeedsMappingDecisionFixture();
  assert.equal(applySuggestionSuccessMessage(row, { validationStatus: "needs_mapping" }), undefined);
});
