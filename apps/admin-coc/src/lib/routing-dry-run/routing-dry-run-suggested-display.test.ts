import test from "node:test";
import assert from "node:assert/strict";
import {
  suggestedValidationLabel,
  suggestionAlignsWithOperatorStatus,
} from "./routing-dry-run-suggested-display.ts";
import { defaultRoutingValidationSuggestion } from "./routing-dry-run-suggestion-fixture.ts";

test("suggestedValidationLabel includes suggested status", () => {
  const label = suggestedValidationLabel({
    ...defaultRoutingValidationSuggestion,
    suggestedValidationStatus: "matched_legacy",
  });
  assert.match(label, /Matched legacy/);
});

test("suggestionAlignsWithOperatorStatus compares operator vs suggestion", () => {
  assert.equal(
    suggestionAlignsWithOperatorStatus("mismatch", {
      ...defaultRoutingValidationSuggestion,
      suggestedValidationStatus: "mismatch",
    }),
    true
  );
  assert.equal(
    suggestionAlignsWithOperatorStatus("matched_legacy", {
      ...defaultRoutingValidationSuggestion,
      suggestedValidationStatus: "mismatch",
    }),
    false
  );
});
