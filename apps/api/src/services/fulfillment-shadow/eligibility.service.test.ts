import test from "node:test";
import assert from "node:assert/strict";

import { evaluateLeadEligibility, type EligibilityEvaluationInput } from "./eligibility.service.js";

const baseFacebookNestedEvent = {
  id: "evt_fb",
  sourceLeadUid: "lead_fb",
  sourceProvider: "facebook",
  sourceSystem: "meta_lead_ads",
  normalizedPayloadJson: {
    contact: {
      phone_e164: "+15551234567",
      email: "lead@example.com",
      state: "Texas",
    },
  },
  enrichmentMetadataJson: { sourceLane: "facebook_meta_lead_ads" },
} as EligibilityEvaluationInput["sourceLeadEvent"];

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
  assert.deepEqual(result.reasonCodes, []);
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
  assert.ok(result.reasonCodes.includes("duplicate_unchecked"));
});

test("production-shaped Facebook nested payload resolves meta proof policy without missing identity", () => {
  const result = evaluateLeadEligibility({
    sourceLeadEvent: baseFacebookNestedEvent,
    leadProof: null,
    verification: null,
  });
  assert.equal(result.status, "review_required");
  assert.equal(result.proofResult.proofPolicyKey, "meta_lead_ads");
  assert.ok(result.requiredFieldResult.phonePresent);
  assert.ok(result.requiredFieldResult.emailPresent);
  assert.ok(result.requiredFieldResult.statePresent);
  assert.ok(result.reasonCodes.includes("duplicate_unchecked"));
  assert.ok(!result.reasonCodes.includes("missing_phone"));
  assert.ok(!result.reasonCodes.includes("missing_email"));
  assert.ok(!result.reasonCodes.includes("missing_state"));
  assert.ok(!result.reasonCodes.includes("proof_review_required"));
  assert.ok(!result.reasonCodes.includes("consent_review_required"));
});

test("Facebook nested payload becomes eligible with explicitly acceptable duplicate verification", () => {
  const result = evaluateLeadEligibility({
    sourceLeadEvent: baseFacebookNestedEvent,
    leadProof: null,
    verification: { duplicateStatus: "UNIQUE", verificationStatus: "PASSED" },
  });
  assert.equal(result.status, "eligible");
  assert.deepEqual(result.reasonCodes, []);
});

const duplicateStatuses = [
  "UNCHECKED",
  "UNIQUE",
  "DUPLICATE_GLOBAL",
  "DUPLICATE_BUYER",
  "DUPLICATE_RECENT",
  "POSSIBLE_MATCH",
] as const;

for (const duplicateStatus of duplicateStatuses) {
  test(`duplicate status ${duplicateStatus} is classified fail-closed or explicit`, () => {
    const result = evaluateLeadEligibility({
      sourceLeadEvent: {
        id: `evt_dup_${duplicateStatus}`,
        sourceLeadUid: `lead_dup_${duplicateStatus}`,
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        normalizedPayloadJson: {
          phone_e164: "+15555550123",
          email: "jane@example.com",
          state: "NC",
        },
        enrichmentMetadataJson: { sourceLane: "meta_lead_ads" },
      },
      leadProof: null,
      verification: { duplicateStatus, verificationStatus: "UNCHECKED" },
    });

    if (duplicateStatus === "UNIQUE") {
      assert.equal(result.status, "eligible");
      assert.ok(!result.reasonCodes.includes("duplicate_unchecked"));
      return;
    }
    if (duplicateStatus === "DUPLICATE_GLOBAL" || duplicateStatus === "DUPLICATE_BUYER") {
      assert.equal(result.status, "ineligible");
      assert.ok(result.reasonCodes.includes("duplicate_blocked"));
      return;
    }
    if (duplicateStatus === "DUPLICATE_RECENT" || duplicateStatus === "POSSIBLE_MATCH") {
      assert.equal(result.status, "review_required");
      assert.ok(result.reasonCodes.includes("duplicate_review_required"));
      return;
    }
    assert.equal(result.status, "review_required");
    assert.ok(result.reasonCodes.includes("duplicate_unchecked"));
  });
}

test("missing verification record is review_required with duplicate_unchecked", () => {
  const result = evaluateLeadEligibility({
    sourceLeadEvent: baseFacebookNestedEvent,
    leadProof: null,
    verification: null,
  });
  assert.equal(result.status, "review_required");
  assert.ok(result.reasonCodes.includes("duplicate_unchecked"));
});

test("undefined proof status does not add proof_review_required for zero-artifact lane", () => {
  const result = evaluateLeadEligibility({
    sourceLeadEvent: baseFacebookNestedEvent,
    leadProof: null,
    verification: { duplicateStatus: "UNIQUE", verificationStatus: "PASSED" },
  });
  assert.ok(!result.reasonCodes.includes("proof_review_required"));
});
