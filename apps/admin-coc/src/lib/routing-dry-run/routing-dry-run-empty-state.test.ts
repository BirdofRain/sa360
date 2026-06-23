import test from "node:test";
import assert from "node:assert/strict";
import { routingDryRunEmptyHint } from "./routing-dry-run-empty-state.ts";

test("routingDryRunEmptyHint shows filter message when filtered empty", () => {
  const hint = routingDryRunEmptyHint({
    configured: true,
    hasApiError: false,
    itemCount: 0,
    matchedFilter: "matched",
    validationStatusFilter: "all",
    reviewQueueFilter: "all",
  });
  assert.equal(hint, "No decisions match this filter.");
});

test("routingDryRunEmptyHint shows seed hint when unfiltered empty (all masters)", () => {
  const hint = routingDryRunEmptyHint({
    configured: true,
    hasApiError: false,
    itemCount: 0,
    matchedFilter: "all",
    validationStatusFilter: "all",
    reviewQueueFilter: "all",
  });
  assert.match(hint ?? "", /lead_created/);
});

test("routingDryRunEmptyHint is null when API error", () => {
  const hint = routingDryRunEmptyHint({
    configured: true,
    hasApiError: true,
    itemCount: 0,
    matchedFilter: "all",
    validationStatusFilter: "all",
    reviewQueueFilter: "all",
  });
  assert.equal(hint, null);
});
