import test from "node:test";
import assert from "node:assert/strict";
import { finalizeRoutingDryRunStats } from "./routing-dry-run-stats.service.js";

test("finalizeRoutingDryRunStats computes matchRate and validationCoverage", () => {
  const stats = finalizeRoutingDryRunStats(
    { masterClientAccountId: "master_1" },
    {
      totalDecisions: 10,
      matched: 8,
      reviewRequired: 2,
      unreviewed: 4,
      generatedPlans: 5,
      needsConfigPlans: 2,
      validationGroups: [
        { validationStatus: "matched_legacy", _count: 3 },
        { validationStatus: "mismatch", _count: 2 },
        { validationStatus: "needs_mapping", _count: 1 },
      ],
    }
  );
  assert.equal(stats.totalDecisions, 10);
  assert.equal(stats.matched, 8);
  assert.equal(stats.validatedMatchedLegacy, 3);
  assert.equal(stats.mismatches, 2);
  assert.equal(stats.needsMapping, 1);
  assert.equal(stats.unreviewed, 4);
  assert.equal(stats.matchRate, 0.8);
  assert.equal(stats.validationCoverage, 0.6);
});
