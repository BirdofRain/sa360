import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSourceLeadEventCorrelation,
  missingPersistedDuplicateAssessmentSummary,
} from "./source-lead-duplicate-risk.service.js";

test("evaluateSourceLeadEventCorrelation skips generated lead ids", async () => {
  const result = await evaluateSourceLeadEventCorrelation({
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_legacy",
    sourceLeadId: "gen-abc123",
    excludeEventId: "evt_new",
    sourceLeadIdGenerated: true,
  });
  assert.equal(result.correlated, false);
  assert.equal(result.blocksDelivery, false);
});

test("a missing persisted assessment stays nonblocking for routing and GHL", () => {
  const summary = missingPersistedDuplicateAssessmentSummary();
  assert.equal(summary.blocksDelivery, false);
  assert.equal(summary.blocksLiveDelivery, false);
  assert.equal(summary.riskLevel, "none");
  assert.equal(summary.recommendedAction, "No duplicate risk assessment persisted.");
});
