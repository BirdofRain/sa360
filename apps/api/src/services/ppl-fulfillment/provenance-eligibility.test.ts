import assert from "node:assert/strict";
import { test } from "node:test";

import { PROVENANCE_ELIGIBILITY_MATRIX } from "./provenance-eligibility-matrix.js";
import {
  evaluateProvenanceEligibility,
  PPL_PROVENANCE_ELIGIBILITY_POLICY_ID,
} from "./provenance-eligibility.js";

test("provenance eligibility matrix matches every policy branch", () => {
  assert.ok(PROVENANCE_ELIGIBILITY_MATRIX.length >= 18);
  for (const entry of PROVENANCE_ELIGIBILITY_MATRIX) {
    const decision = evaluateProvenanceEligibility(entry.input);
    assert.equal(decision.code, entry.code, entry.name);
    assert.equal(decision.eligible, entry.eligible, entry.name);
    assert.equal(decision.policyId, PPL_PROVENANCE_ELIGIBILITY_POLICY_ID);
  }
});

test("campaign labels, exclusivity, and Used By are not eligibility inputs", () => {
  const decision = evaluateProvenanceEligibility({
    originClientAccountId: null,
    itemSourceProvider: "manual_import",
    eventSourceProvider: "manual_import",
    eventSourceSystem: "leadcapture_io_legacy",
  });
  assert.equal(decision.code, "unresolved_origin");
  assert.equal(
    "campaignName" in decision || "exclusivityMode" in decision || "usedBy" in decision,
    false
  );
});
