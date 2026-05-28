import test from "node:test";
import assert from "node:assert/strict";
import { computeRoutingDryRunPageStats } from "./routing-dry-run-stats.ts";
import { routingDryRunDecisionFixture } from "./routing-dry-run-suggestion-fixture.ts";

test("computeRoutingDryRunPageStats counts matched review and validation buckets", () => {
  const stats = computeRoutingDryRunPageStats([
    routingDryRunDecisionFixture({ matched: true, validationStatus: "matched_legacy" }),
    routingDryRunDecisionFixture({ matched: true, validationStatus: "mismatch" }),
    routingDryRunDecisionFixture({ matched: false, validationStatus: "needs_mapping" }),
    routingDryRunDecisionFixture({ matched: true, validationStatus: null }),
  ]);
  assert.equal(stats.matchedPredictions, 3);
  assert.equal(stats.reviewRequired, 1);
  assert.equal(stats.validatedMatchedLegacy, 1);
  assert.equal(stats.mismatches, 1);
  assert.equal(stats.needsMapping, 1);
});
