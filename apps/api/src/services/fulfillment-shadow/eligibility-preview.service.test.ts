import test from "node:test";
import assert from "node:assert/strict";

import { buildEligibilityPreviewForSourceLead } from "./eligibility-preview.service.js";

test("buildEligibilityPreviewForSourceLead is read-only and masks identity", async () => {
  const writes: string[] = [];
  const db = {
    sourceLeadEvent: {
      findUnique: async () => ({
        id: "evt_preview",
        sourceLeadUid: "lead_preview",
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
      }),
    },
    leadProof: { findUnique: async () => null },
    leadVerificationResult: { findUnique: async () => null },
    fulfillmentOutbox: { upsert: async () => { writes.push("outbox"); } },
    leadEligibilityAssessment: { upsert: async () => { writes.push("eligibility"); } },
    leadAllocation: { create: async () => { writes.push("allocation"); } },
  };
  const result = await buildEligibilityPreviewForSourceLead("evt_preview", db as never);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.preview.phonePresent, true);
    assert.equal(result.preview.resolvedProofPolicy, "meta_lead_ads");
    assert.equal(result.preview.predictedEligibilityStatus, "review_required");
    assert.ok(result.preview.predictedReasonCodes.includes("duplicate_unchecked"));
    assert.ok(result.preview.maskedPhone?.includes("***"));
    assert.ok(result.preview.maskedEmail?.includes("***"));
  }
  assert.deepEqual(writes, []);
});

test("buildEligibilityPreviewForSourceLead returns malformed payload error", async () => {
  const result = await buildEligibilityPreviewForSourceLead("evt_bad", {
    sourceLeadEvent: {
      findUnique: async () => ({
        id: "evt_bad",
        sourceLeadUid: null,
        sourceProvider: "facebook",
        sourceSystem: "meta",
        normalizedPayloadJson: "not-json-object",
        enrichmentMetadataJson: null,
      }),
    },
  } as never);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "malformed_normalized_payload");
  }
});
