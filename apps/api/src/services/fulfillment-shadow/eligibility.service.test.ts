import test from "node:test";
import assert from "node:assert/strict";

import { evaluateLeadEligibility } from "./eligibility.service.js";

const baseEvent = {
  id: "evt_elig_1",
  sourceLeadUid: "facebook-meta_lead_ads-leadgen_123",
  sourceProvider: "facebook" as const,
  sourceSystem: "meta_lead_ads" as const,
  normalizedPayloadJson: {
    contact: {
      phone_e164: "+14155550100",
      email: "jane.doe@example.test",
      state: "Texas",
    },
  },
  enrichmentMetadataJson: null,
};

test("PROOF_ATTACHED + PASSED/UNIQUE has no proof_review_required or duplicate_unchecked", () => {
  const result = evaluateLeadEligibility({
    sourceLeadEvent: baseEvent,
    leadProof: {
      proofStatus: "PROOF_ATTACHED",
      proofMissingReasons: [],
      phoneE164: "+14155550100",
      email: "jane.doe@example.test",
      consentText: null,
    },
    verification: { verificationStatus: "PASSED", duplicateStatus: "UNIQUE" },
  });
  assert.equal(result.status, "eligible");
  assert.equal(result.reasonCodes.includes("proof_review_required"), false);
  assert.equal(result.reasonCodes.includes("duplicate_unchecked"), false);
});

test("PROOF_ATTACHED + missing verification keeps duplicate_unchecked", () => {
  const result = evaluateLeadEligibility({
    sourceLeadEvent: baseEvent,
    leadProof: {
      proofStatus: "PROOF_ATTACHED",
      proofMissingReasons: [],
      phoneE164: "+14155550100",
      email: "jane.doe@example.test",
      consentText: null,
    },
    verification: null,
  });
  assert.equal(result.reasonCodes.includes("duplicate_unchecked"), true);
  assert.equal(result.status, "review_required");
});

test("PROOF_ATTACHED + POSSIBLE_MATCH keeps duplicate_review_required", () => {
  const result = evaluateLeadEligibility({
    sourceLeadEvent: baseEvent,
    leadProof: {
      proofStatus: "PROOF_ATTACHED",
      proofMissingReasons: [],
      phoneE164: "+14155550100",
      email: "jane.doe@example.test",
      consentText: null,
    },
    verification: { verificationStatus: "PASSED", duplicateStatus: "POSSIBLE_MATCH" },
  });
  assert.equal(result.reasonCodes.includes("duplicate_review_required"), true);
  assert.equal(result.status, "review_required");
});

test("missing proof + PASSED/UNIQUE keeps proof_review_required", () => {
  const result = evaluateLeadEligibility({
    sourceLeadEvent: baseEvent,
    leadProof: null,
    verification: { verificationStatus: "PASSED", duplicateStatus: "UNIQUE" },
  });
  assert.equal(result.reasonCodes.includes("proof_review_required"), true);
  assert.equal(result.reasonCodes.includes("duplicate_unchecked"), false);
});
