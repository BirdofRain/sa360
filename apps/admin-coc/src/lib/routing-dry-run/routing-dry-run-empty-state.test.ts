import test from "node:test";
import assert from "node:assert/strict";
import { routingDryRunEmptyHint } from "./routing-dry-run-empty-state.ts";

test("routingDryRunEmptyHint shows filter message when filtered empty", () => {
  const hint = routingDryRunEmptyHint({
    configured: true,
    hasMaster: true,
    hasApiError: false,
    itemCount: 0,
    matchedFilter: "matched",
    validationStatusFilter: "all",
    reviewQueueFilter: "all",
  });
  assert.equal(hint, "No decisions match this filter.");
});

test("routingDryRunEmptyHint shows seed hint when unfiltered empty", () => {
  const hint = routingDryRunEmptyHint({
    configured: true,
    hasMaster: true,
    hasApiError: false,
    itemCount: 0,
    matchedFilter: "all",
    validationStatusFilter: "all",
    reviewQueueFilter: "all",
  });
  assert.match(hint ?? "", /lead_created/);
});
