import test from "node:test";
import assert from "node:assert/strict";

import { evaluateLeadEligibility } from "./eligibility.service.js";

test("complete proof-backed lead becomes eligible", () => {
  const result = evaluateLeadEligibility({
    sourceLeadEvent: {
      id: "evt_1",
      sourceLeadUid: "lead_1",
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      normalizedPayloadJson: {
        phone_e164: "+15555550123",
        email: "jane@example.com",
        state: "NC",
      },
      enrichmentMetadataJson: { sourceLane: "meta_lead_ads" },
    },
    leadProof: {
      proofStatus: "PROOF_ATTACHED",
      proofMissingReasons: [],
      phoneE164: "+15555550123",
      email: "jane@example.com",
      consentText: "I agree",
    },
    verification: { duplicateStatus: "UNIQUE", verificationStatus: "PASSED" },
  });
  assert.equal(result.status, "eligible");
});

test("missing required proof becomes review-required for leadcapture lane", () => {
  const result = evaluateLeadEligibility({
    sourceLeadEvent: {
      id: "evt_2",
      sourceLeadUid: "lead_2",
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_legacy",
      normalizedPayloadJson: {
        phone_e164: "+15555550123",
        email: "jane@example.com",
        state: "NC",
      },
      enrichmentMetadataJson: { sourceLane: "leadcapture_io" },
    },
    leadProof: {
      proofStatus: "PROOF_MISSING",
      proofMissingReasons: ["artifact missing"],
      phoneE164: "+15555550123",
      email: "jane@example.com",
      consentText: null,
    },
    verification: { duplicateStatus: "UNIQUE", verificationStatus: "UNCHECKED" },
  });
  assert.equal(result.status, "ineligible");
  assert.ok(result.reasonCodes.includes("proof_incomplete"));
});

test("missing phone is explicitly ineligible", () => {
  const result = evaluateLeadEligibility({
    sourceLeadEvent: {
      id: "evt_3",
      sourceLeadUid: "lead_3",
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      normalizedPayloadJson: { email: "jane@example.com", state: "NC" },
      enrichmentMetadataJson: { sourceLane: "meta_lead_ads" },
    },
    leadProof: null,
    verification: null,
  });
  assert.equal(result.status, "ineligible");
  assert.ok(result.reasonCodes.includes("missing_phone"));
});
