import test from "node:test";
import assert from "node:assert/strict";
import type { RoutingDryRunDecisionItem } from "./types";
import { routingDryRunDecisionFixture } from "./routing-dry-run-suggestion-fixture.ts";
import {
  effectiveValidationStatus,
  validationStatusBadgeClass,
  validationStatusLabel,
} from "./routing-dry-run-validation-display.ts";

function row(partial: Partial<RoutingDryRunDecisionItem>): RoutingDryRunDecisionItem {
  return routingDryRunDecisionFixture(partial);
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
