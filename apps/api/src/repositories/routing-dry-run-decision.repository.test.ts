import test from "node:test";
import assert from "node:assert/strict";
import { buildRoutingDryRunDecisionWhere } from "./routing-dry-run-decision.repository.js";

test("buildRoutingDryRunDecisionWhere omits master filter when not provided", () => {
  const where = buildRoutingDryRunDecisionWhere({ matched: true });
  assert.equal(where.masterClientAccountId, undefined);
  assert.equal(where.matched, true);
  assert.equal(where.cleanupStatus, null);
});

test("buildRoutingDryRunDecisionWhere applies master filter when provided", () => {
  const where = buildRoutingDryRunDecisionWhere({
    masterClientAccountId: "master_1",
    matched: false,
  });
  assert.equal(where.masterClientAccountId, "master_1");
  assert.equal(where.matched, false);
});

test("buildRoutingDryRunDecisionWhere supports explicit cleanup filters", () => {
  const includeAll = buildRoutingDryRunDecisionWhere({ includeCleanup: true });
  assert.equal(includeAll.cleanupStatus, undefined);

  const onlyMarked = buildRoutingDryRunDecisionWhere({
    cleanupStatus: "INCOMPLETE_MISSING_CLIENT_AND_NAME",
  });
  assert.equal(onlyMarked.cleanupStatus, "INCOMPLETE_MISSING_CLIENT_AND_NAME");
});
