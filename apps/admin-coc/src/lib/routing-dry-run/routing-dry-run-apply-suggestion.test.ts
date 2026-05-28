import test from "node:test";
import assert from "node:assert/strict";
import { buildApplySuggestionPatch } from "./routing-dry-run-apply-suggestion.ts";
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
