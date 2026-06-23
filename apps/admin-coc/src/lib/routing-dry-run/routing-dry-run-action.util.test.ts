import test from "node:test";
import assert from "node:assert/strict";
import { runRoutingDryRunAction } from "./routing-dry-run-action.util.ts";
import { ROUTING_DRY_RUN_ACTION_FAILED } from "./routing-dry-run-safe.ts";

test("runRoutingDryRunAction returns structured inline error when fn throws", async () => {
  const res = await runRoutingDryRunAction(async () => {
    throw new Error("simulated API 500");
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, "action_failed");
    assert.equal(res.error.message, ROUTING_DRY_RUN_ACTION_FAILED);
    assert.match(res.error.details ?? "", /simulated API 500/);
  }
});

test("runRoutingDryRunAction returns data on success", async () => {
  const res = await runRoutingDryRunAction(async () => ({ id: "x" }));
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.id, "x");
});
