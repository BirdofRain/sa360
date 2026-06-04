import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRoutingDryRunStats } from "./routing-dry-run-stats-normalize.ts";

test("normalizeRoutingDryRunStats fills safe defaults for partial stats", () => {
  const stats = normalizeRoutingDryRunStats({
    masterClientAccountId: "lal_master_vet",
    totalDecisions: 3,
    matched: null,
    mismatches: undefined,
  });
  assert.ok(stats);
  assert.equal(stats?.masterClientAccountId, "lal_master_vet");
  assert.equal(stats?.totalDecisions, 3);
  assert.equal(stats?.matched, 0);
  assert.equal(stats?.mismatches, 0);
});

test("normalizeRoutingDryRunStats returns null without master", () => {
  assert.equal(normalizeRoutingDryRunStats({ totalDecisions: 1 }), null);
});
