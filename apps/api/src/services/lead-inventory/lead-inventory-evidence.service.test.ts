import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateInventoryEvidenceReadiness } from "./lead-inventory-evidence.service.js";

test("proof-required lane blocks missing proof", () => {
  const result = evaluateInventoryEvidenceReadiness({
    sourceLeadEvent: {
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_legacy",
      enrichmentMetadataJson: { sourceLane: "leadcapture_io" },
    },
    leadProof: { proofStatus: "UNREVIEWED" },
    verification: { verificationStatus: "PASSED", duplicateStatus: "UNIQUE" },
  });
  assert.ok(result.blockers.includes("proof_not_ready"));
  assert.equal(result.proofPolicyKey, "leadcapture_io");
});

test("lane with no required artifacts warns instead of blocking unreviewed proof", () => {
  const result = evaluateInventoryEvidenceReadiness({
    sourceLeadEvent: {
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      enrichmentMetadataJson: {},
    },
    leadProof: { proofStatus: "UNREVIEWED" },
    verification: { verificationStatus: "PASSED", duplicateStatus: "UNIQUE" },
  });
  assert.equal(result.blockers.includes("proof_not_ready"), false);
  assert.ok(result.warnings.includes("proof_needs_review"));
});

test("missing verification and duplicate risk remain fail-closed", () => {
  const result = evaluateInventoryEvidenceReadiness({
    sourceLeadEvent: {
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      enrichmentMetadataJson: {},
    },
    leadProof: { proofStatus: "PROOF_ATTACHED" },
    verification: { verificationStatus: "FAILED", duplicateStatus: "DUPLICATE_GLOBAL" },
  });
  assert.ok(result.blockers.includes("verification_not_passed"));
  assert.ok(result.blockers.includes("duplicate_risk"));
});
