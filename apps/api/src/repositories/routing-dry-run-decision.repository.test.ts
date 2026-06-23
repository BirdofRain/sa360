import test from "node:test";
import assert from "node:assert/strict";
import { buildRoutingDryRunDecisionWhere } from "./routing-dry-run-decision.repository.js";

test("buildRoutingDryRunDecisionWhere omits master filter when not provided", () => {
  const where = buildRoutingDryRunDecisionWhere({ matched: true });
  assert.equal(where.masterClientAccountId, undefined);
  assert.equal(where.matched, true);
});

test("buildRoutingDryRunDecisionWhere applies master filter when provided", () => {
  const where = buildRoutingDryRunDecisionWhere({
    masterClientAccountId: "master_1",
    matched: false,
  });
  assert.equal(where.masterClientAccountId, "master_1");
  assert.equal(where.matched, false);
});
