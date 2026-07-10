import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import {
  adminFulfillmentShadowRoutes,
  type AdminFulfillmentShadowRoutesOptions,
} from "./admin-fulfillment-shadow.js";

const HEADER = "x-sa360-admin-key";

async function buildApp(opts: AdminFulfillmentShadowRoutesOptions = {}) {
  const app = Fastify({ logger: false });
  await app.register(adminFulfillmentShadowRoutes, { prefix: "/admin/v1", ...opts });
  return app;
}

test("GET eligibility-preview requires admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/eligibility-preview",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET eligibility-preview returns preview without persisting assessments", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  let writeAttempted = false;
  const app = await buildApp({
    buildEligibilityPreviewImpl: async () => {
      writeAttempted = false;
      return {
        ok: true,
        preview: {
          sourceLeadEventId: "evt_1",
          sourceLeadUid: "lead_1",
          resolvedSourceLane: "facebook_meta_lead_ads",
          resolvedProofPolicy: "meta_lead_ads",
          proofStatus: null,
          phonePresent: true,
          emailPresent: true,
          statePresent: true,
          state: "Texas",
          maskedPhone: "(555) ***-4567",
          maskedEmail: "l***@example.com",
          consentPresent: false,
          duplicateStatus: null,
          verificationStatus: null,
          verificationPresent: false,
          predictedEligibilityStatus: "review_required",
          predictedReasonCodes: ["duplicate_unchecked"],
          policyKey: "lf2_shadow_eligibility",
          policyVersion: "1.0.0",
          summaries: {
            proofBlocksEligibility: false,
            proofRequiresReview: false,
            duplicateBlocked: false,
            duplicateRequiresReview: false,
            duplicateUnchecked: true,
            consentReviewRequired: false,
            requiredFieldsComplete: true,
          },
        },
      };
    },
  });

  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/eligibility-preview",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { preview: Record<string, unknown> };
  assert.equal(body.preview.predictedEligibilityStatus, "review_required");
  assert.equal(writeAttempted, false);
  assert.equal("rawPayloadJson" in body.preview, false);
  assert.equal("normalizedPayloadJson" in body.preview, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET eligibility-preview returns 404 for missing lead", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    buildEligibilityPreviewImpl: async () => ({ ok: false, error: "source_lead_not_found" }),
  });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/fulfillment-shadow/source-leads/missing/eligibility-preview",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET eligibility-preview returns 400 for malformed payload", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    buildEligibilityPreviewImpl: async () => ({ ok: false, error: "malformed_normalized_payload" }),
  });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_bad/eligibility-preview",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST ghl-duplicate-search requires admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/ghl-duplicate-search",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST ghl-duplicate-search returns safe summary from read-only service", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    runGhlDuplicateSearchImpl: async () => ({
      ok: true,
      summary: {
        sourceLeadEventId: "evt_1",
        clientAccountId: "smart_agent_360_demo_2",
        destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
        classification: "no_duplicate_found",
        phonePresent: true,
        emailPresent: true,
        phoneSearchAttempted: true,
        emailSearchAttempted: false,
        matchCount: 0,
        matchedContactIdGhl: null,
        reasonCode: "authoritative_search_not_found",
      },
    }),
  });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/ghl-duplicate-search",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { summary: { classification: string } };
  assert.equal(body.summary.classification, "no_duplicate_found");
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
