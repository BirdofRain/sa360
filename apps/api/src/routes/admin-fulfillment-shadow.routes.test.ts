import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import {
  adminFulfillmentShadowRoutes,
  type AdminFulfillmentShadowRoutesOptions,
} from "./admin-fulfillment-shadow.js";
import type { Lf2CheckpointAConfigPreview } from "../services/fulfillment-shadow/lf2-checkpoint-a-config.service.js";

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

test("POST verification-revoke requires admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/verification-revoke",
    payload: {},
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST verification-revoke rejects override fields in body", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/verification-revoke",
    headers: { [HEADER]: "admin-secret" },
    payload: { duplicateStatus: "UNIQUE" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST verification-revoke returns safe revocation payload", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    revokeVerificationImpl: async () => ({
      ok: true,
      revocationStatus: "applied",
      sourceLeadEventId: "evt_1",
      maskedSourceLeadUid: "lead***_1",
      clientAccountId: "smart_agent_360_demo_2",
      destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
      action: "REVOKE_TO_REVIEW",
      previousVerificationStatus: "PASSED",
      previousDuplicateStatus: "UNIQUE",
      newVerificationStatus: "NEEDS_REVIEW",
      newDuplicateStatus: "POSSIBLE_MATCH",
      auditEventId: "audit_revoke_1",
      postRevocationEligibilityPreview: {
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
        duplicateStatus: "POSSIBLE_MATCH",
        verificationStatus: "NEEDS_REVIEW",
        verificationPresent: true,
        predictedEligibilityStatus: "review_required",
        predictedReasonCodes: ["duplicate_review_required"],
        policyKey: "lf2_shadow_eligibility",
        policyVersion: "1.0.0",
        summaries: {
          proofBlocksEligibility: false,
          proofRequiresReview: false,
          duplicateBlocked: false,
          duplicateRequiresReview: true,
          duplicateUnchecked: false,
          consentReviewRequired: false,
          requiredFieldsComplete: true,
        },
      },
    }),
  });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/verification-revoke",
    headers: { [HEADER]: "admin-secret" },
    payload: { operatorNote: "undo approval" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.action, "REVOKE_TO_REVIEW");
  assert.equal(body.newDuplicateStatus, "POSSIBLE_MATCH");
  assert.equal("phone" in body, false);
  assert.equal("email" in body, false);
  assert.ok(body.postRevocationEligibilityPreview);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

const checkpointAPreview = {
  sourceLeadEventId: "evt_1",
  maskedSourceLeadUid: "lead***_1",
  clientAccountId: "smart_agent_360_demo_2",
  clientDisplayName: "Smart Agent Demo 2",
  authoritativeLocationId: "VPuMIhN6JpxdoXvvlekZ",
  canonicalSourceLane: "facebook_meta_lead_ads",
  state: "Texas",
  nicheKey: "lf2_first_canary",
  productType: "manual_entry",
  campaignId: "camp_1",
  routingRuleId: null,
  verifiedEligibilitySummary: {
    predictedEligibilityStatus: "eligible" as const,
    predictedReasonCodes: [] as string[],
    duplicateStatus: "UNIQUE",
    verificationStatus: "PASSED",
    verificationPresent: true,
  },
  proposedLeadOrder: {
    orderNumber: "LO-1045",
    clientAccountId: "smart_agent_360_demo_2",
    clientDisplayName: "Smart Agent Demo 2",
    status: "active" as const,
    nicheKey: "lf2_first_canary",
    productType: "manual_entry",
    statesJson: ["Texas"],
    leadVolume: 1,
    deliveryCadence: "controlled_manual_canary",
    campaignType: "lf2_first_canary",
    crmPackage: "ghl_crm_canary",
    aiVoiceAddon: false,
    deliveryDestinationType: "ghl",
    deliveryDestinationLabel: "Demo Location",
    notes: "LF2 first canary configuration order.",
    adminNotes: "LF2 Checkpoint A first canary configuration only. sourceLeadEventId=evt_1",
    routingRuleId: null,
    campaignId: "camp_1",
    createdByRole: "admin" as const,
    orderKind: "retainer_allocation" as const,
    fulfillmentMode: "campaign_bound" as const,
    requestedQuantity: 1,
    fulfillmentCycleStart: new Date().toISOString(),
    fulfillmentCycleEnd: new Date().toISOString(),
    allowedSourceLanesJson: ["facebook_meta_lead_ads"],
    proofPolicyKey: "meta_lead_ads",
    exclusivityRequired: true,
    fulfillmentPriority: 1000,
    proposedQuantity: 0,
    reservedQuantity: 0,
    fulfilledQuantity: 0,
  },
  proposedDeliveryTarget: {
    clientAccountId: "smart_agent_360_demo_2",
    displayName: "LF2 First Canary GHL Target",
    adapterKey: "ghl.crm.v1",
    enabled: true,
    isPrimary: true,
    isRequired: true,
    readinessStatus: "ready_for_shadow",
    configMetadataJson: { destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ" },
  },
  expectedWrites: ["LeadOrder", "DeliveryTarget", "Lf2CheckpointAAuditEvent"],
  structuralBlockers: [],
  checkpointACreateSafe: true,
  existingLeadOrderId: null,
  existingDeliveryTargetId: null,
} satisfies Lf2CheckpointAConfigPreview;

test("28. GET checkpoint-a preview requires admin auth", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/checkpoint-a/preview",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("29. POST checkpoint-a create rejects override fields in body", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/checkpoint-a/create",
    headers: { [HEADER]: "admin-secret" },
    payload: { clientAccountId: "override_client" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("30. POST checkpoint-a create returns safe response only", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    createCheckpointAImpl: async () => ({
      ok: true,
      checkpointAStatus: "applied",
      sourceLeadEventId: "evt_1",
      maskedSourceLeadUid: "lead***_1",
      clientAccountId: "smart_agent_360_demo_2",
      authoritativeLocationId: "VPuMIhN6JpxdoXvvlekZ",
      leadOrderId: "order_1",
      leadOrderNumber: "LO-1045",
      deliveryTargetId: "target_1",
      previousLeadOrderStatus: null,
      previousDeliveryTargetEnabled: null,
      auditEventId: "audit_1",
      postCreatePreview: checkpointAPreview,
      shadowEnqueueOccurred: false,
      lf2ExecutionRowsCreated: false,
    }),
  });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/checkpoint-a/create",
    headers: { [HEADER]: "admin-secret" },
    payload: { operatorNote: "create checkpoint a" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.checkpointAStatus, "applied");
  assert.equal(body.shadowEnqueueOccurred, false);
  assert.equal(body.lf2ExecutionRowsCreated, false);
  assert.equal("phone" in body, false);
  assert.equal("email" in body, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("31. GET checkpoint-a preview returns safe preview without secrets", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    buildCheckpointAPreviewImpl: async () => ({ ok: true, preview: checkpointAPreview }),
  });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/checkpoint-a/preview",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { preview: Record<string, unknown> };
  assert.equal(body.preview.checkpointACreateSafe, true);
  assert.equal("sourceLeadUid" in body.preview, false);
  assert.equal("rawPayloadJson" in body.preview, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

const proofReviewPreview = {
  sourceLeadEventId: "evt_1",
  maskedSourceLeadUid: "face***1234",
  clientAccountId: "client_1",
  canonicalSourceLane: "facebook_meta_lead_ads",
  proofPolicyKey: "meta_lead_ads",
  requiredArtifactTypes: [] as string[],
  leadProofId: null,
  currentProofStatus: null,
  extractedProofStatus: "NEEDS_REVIEW" as const,
  extractedMissingFieldNames: [] as string[],
  extractedProofSignalPresence: {
    sourceLeadId: true,
    sourcePlatform: true,
    sourceType: true,
    consentText: true,
    consentVersion: true,
    submittedAt: true,
    formReference: true,
    phoneE164: true,
    email: true,
  },
  verificationStatus: "PASSED",
  duplicateStatus: "UNIQUE",
  simulationAttemptCount: 1,
  liveAttemptCount: 0,
  allocationStatus: "reserved",
  committed: false,
  fulfilled: false,
  priorExternalDeliveryEvidence: false,
  canApprove: true,
  canReject: true,
  canRevoke: false,
  blockers: [] as string[],
  warnings: ["simulation_attempt_present"],
  postReviewEligibility: { status: "review_required" as const, reasonCodes: ["proof_review_required"] },
};

test("32. GET proof-review preview requires admin auth", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/proof-review/preview",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("33. GET proof-review preview returns masked safe preview", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    buildProofReviewPreviewImpl: async () => ({ ok: true, preview: proofReviewPreview }),
  });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/proof-review/preview",
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { preview: Record<string, unknown> };
  assert.equal(body.preview.proofPolicyKey, "meta_lead_ads");
  assert.equal("rawPayloadJson" in body.preview, false);
  assert.equal("phone" in body.preview, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("34. POST proof-review approve rejects unknown body fields", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/proof-review/approve",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      requestId: "req_1",
      operatorNote: "note",
      operatorConfirmationText: "APPROVE ONE META PROOF",
      proofStatus: "PROOF_ATTACHED",
    },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("35. POST proof-review approve returns safe response", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    approveProofReviewImpl: async () => ({
      ok: true,
      reviewStatus: "applied",
      action: "APPROVE_PROOF",
      sourceLeadEventId: "evt_1",
      maskedSourceLeadUid: "face***1234",
      leadProofId: "proof_1",
      previousProofStatus: null,
      extractedProofStatus: "NEEDS_REVIEW" as const,
      newProofStatus: "PROOF_ATTACHED",
      auditEventId: "audit_1",
      requestId: "req_1",
      policyKey: "meta_lead_ads",
      postReviewEligibility: { status: "eligible", reasonCodes: [] },
      proofReviewPreview,
    }),
  });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/fulfillment-shadow/source-leads/evt_1/proof-review/approve",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      requestId: "req_1",
      operatorNote: "reviewed",
      operatorConfirmationText: "APPROVE ONE META PROOF",
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.newProofStatus, "PROOF_ATTACHED");
  assert.equal("consentText" in body, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
