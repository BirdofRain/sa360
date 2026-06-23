import test from "node:test";
import assert from "node:assert/strict";
import { routingDryRunEmptyHint } from "./routing-dry-run-empty-state.ts";
import { ROUTING_DRY_RUN_ACTION_FAILED } from "./routing-dry-run-safe.ts";

test("routing dry-run page shows no table empty state when API returns error", () => {
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

test("ROUTING_DRY_RUN_ACTION_FAILED is used for inline API failure banner", () => {
  assert.match(ROUTING_DRY_RUN_ACTION_FAILED, /Routing dry-run action failed/i);
});
