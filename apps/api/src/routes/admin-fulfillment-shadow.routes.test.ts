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
          maskedSourceLeadUid: "lead***_1",
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
  assert.equal("sourceLeadUid" in body.preview, false);
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
        emailSearchAttempted: true,
        phoneSearchOutcome: "not_found",
        emailSearchOutcome: "not_found",
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
  const body = res.json() as { summary: Record<string, unknown> };
  assert.equal(body.summary.classification, "no_duplicate_found");
  assert.equal("accessToken" in body.summary, false);
  assert.equal("query" in body.summary, false);
  assert.equal("phone" in body.summary, false);
  assert.equal("email" in body.summary, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST verification-approve requires admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/verification-approve",
    payload: {},
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST verification-approve rejects override fields in body", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/verification-approve",
    headers: { [HEADER]: "admin-secret" },
    payload: { clientAccountId: "spoofed" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST verification-approve returns safe approval payload", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    approveVerificationImpl: async () => ({
      ok: true,
      approvalStatus: "applied",
      sourceLeadEventId: "evt_1",
      maskedSourceLeadUid: "lead***_1",
      clientAccountId: "smart_agent_360_demo_2",
      destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
      action: "APPROVE_UNIQUE",
      duplicateSearchClassification: "no_duplicate_found",
      duplicateSearchReasonCode: "authoritative_search_not_found",
      previousVerificationStatus: null,
      previousDuplicateStatus: null,
      newVerificationStatus: "PASSED",
      newDuplicateStatus: "UNIQUE",
      auditEventId: "audit_1",
      postApprovalEligibilityPreview: {
        sourceLeadEventId: "evt_1",
        maskedSourceLeadUid: "lead***_1",
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
        duplicateStatus: "UNIQUE",
        verificationStatus: "PASSED",
        verificationPresent: true,
        predictedEligibilityStatus: "eligible",
        predictedReasonCodes: [],
        policyKey: "lf2_shadow_eligibility",
        policyVersion: "1.0.0",
        summaries: {
          proofBlocksEligibility: false,
          proofRequiresReview: false,
          duplicateBlocked: false,
          duplicateRequiresReview: false,
          duplicateUnchecked: false,
          consentReviewRequired: false,
          requiredFieldsComplete: true,
        },
      },
    }),
  });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/verification-approve",
    headers: { [HEADER]: "admin-secret" },
    payload: { operatorNote: "ok" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.approvalStatus, "applied");
  assert.equal(body.newDuplicateStatus, "UNIQUE");
  assert.equal(body.action, "APPROVE_UNIQUE");
  assert.equal(
    (body.postApprovalEligibilityPreview as { predictedEligibilityStatus: string })
      .predictedEligibilityStatus,
    "eligible"
  );
  assert.equal("phone" in body, false);
  assert.equal("email" in body, false);
  assert.equal("sourceLeadUid" in body, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
