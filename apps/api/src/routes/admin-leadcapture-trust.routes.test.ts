import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import {
  adminLeadCaptureTrustRoutes,
  type AdminLeadCaptureTrustRoutesOptions,
} from "./admin-leadcapture-trust.js";

const HEADER = "x-sa360-admin-key";

async function buildApp(opts: AdminLeadCaptureTrustRoutesOptions = {}) {
  const app = Fastify({ logger: false });
  await app.register(adminLeadCaptureTrustRoutes, { prefix: "/admin/v1", ...opts });
  return app;
}

test("POST trust preview requires admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/leadcapture/trust/pilot/preview",
    payload: {
      providerLeadId: "lead-1",
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST trust preview returns non-sensitive summary without writes", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    buildPreviewImpl: async () => ({
      ok: true,
      contentHash: "abc123def456",
      preview: {
        maskedProviderLeadId: "jt-l***2541",
        providerCampaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
        providerFormId: "23381",
        providerFormName: "VET FEX",
        sourceLeadEventId: "evt_1",
        clientAccountId: "vet_life_james_torrey",
        sourceLane: "leadcapture_io",
        correlationClassification: "exact_match",
        proofRecordPresent: false,
        sourceSnapshotPresent: false,
        artifactCount: 1,
        disclosurePresent: true,
        disclosureVersionPresent: true,
        consentAccepted: "yes",
        consentTimestampPresent: true,
        submissionTimestampPresent: true,
        sourceUrlPresent: true,
        ipPresent: true,
        userAgentPresent: true,
        certificatePresent: true,
        providerVerificationStatus: "good",
        contentHashPrefix: "abc123def456".slice(0, 12),
        completenessStatus: "complete",
        missingFields: [],
        warnings: [],
        canAttach: true,
        blockers: [],
      },
    }),
  });

  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/leadcapture/trust/pilot/preview",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      providerLeadId: "jt-legacy-e2e-20260616-112541",
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { preview: Record<string, unknown> };
  assert.equal(body.preview.correlationClassification, "exact_match");
  assert.equal("disclosureText" in body.preview, false);
  assert.equal("email" in body.preview, false);
  assert.equal("phone" in body.preview, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST trust attach requires expectedContentHash and returns contentHashPrefix", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    attachImpl: async () => ({
      ok: true,
      reviewStatus: "applied",
      sourceLeadEventId: "evt_1",
      leadProofId: "proof_1",
      previousProofStatus: null,
      newProofStatus: "PROOF_ATTACHED",
      auditEventId: "audit_1",
      contentHashPrefix: "abc123def456".slice(0, 12),
    }),
  });

  const missingHash = await app.inject({
    method: "POST",
    url: "/admin/v1/leadcapture/trust/pilot/attach",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      providerLeadId: "lead-1",
      sourceLeadEventId: "evt_1",
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      requestId: "req-1",
      operatorNote: "pilot attach",
      operatorConfirmationText: "ATTACH ONE LEADCAPTURE TRUST FORM",
    },
  });
  assert.equal(missingHash.statusCode, 400);

  const ok = await app.inject({
    method: "POST",
    url: "/admin/v1/leadcapture/trust/pilot/attach",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      providerLeadId: "lead-1",
      sourceLeadEventId: "evt_1",
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      requestId: "req-1",
      operatorNote: "pilot attach",
      operatorConfirmationText: "ATTACH ONE LEADCAPTURE TRUST FORM",
      expectedContentHash: "abc123def4567890abcdef1234567890abcdef12",
    },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json() as { contentHashPrefix: string; contentHash?: string };
  assert.equal(body.contentHashPrefix, "abc123def456".slice(0, 12));
  assert.equal("contentHash" in body, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST trust attach rejects unknown body fields", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/leadcapture/trust/pilot/attach",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      providerLeadId: "lead-1",
      sourceLeadEventId: "evt_1",
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      requestId: "req-1",
      operatorNote: "pilot attach",
      operatorConfirmationText: "ATTACH ONE LEADCAPTURE TRUST FORM",
      unexpectedField: true,
    },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST trust attach requires exact confirmation phrase", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    attachImpl: async () => ({ ok: false, error: "invalid_confirmation_text", blockers: ["invalid_confirmation_text"] }),
  });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/leadcapture/trust/pilot/attach",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      providerLeadId: "lead-1",
      sourceLeadEventId: "evt_1",
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      requestId: "req-1",
      operatorNote: "pilot attach",
      operatorConfirmationText: "WRONG PHRASE",
    },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST reconcile-preview enforces strict body and max 25 limit field", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp({
    reconcilePreviewImpl: async () => ({
      ok: true,
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      counts: {
        providerLeadsRead: 1,
        exactMatches: 1,
        previewIdentityMatches: 0,
        unmatched: 0,
        ambiguous: 0,
        campaignMismatch: 0,
        alreadyAttached: 0,
        providerEvidenceChanged: 0,
        completeProof: 1,
        needsReview: 0,
        proofMissing: 0,
        providerErrors: 0,
      },
      rows: [
        {
          maskedProviderLeadId: "jt-l***2541",
          correlationClassification: "exact_match",
          completenessStatus: "complete",
          proofRecordPresent: false,
          alreadyAttached: false,
          providerEvidenceChanged: false,
          contentHashPrefix: "abc123",
        },
      ],
      nextCursor: null,
      hasMore: false,
    }),
  });

  const badLimit = await app.inject({
    method: "POST",
    url: "/admin/v1/leadcapture/trust/pilot/reconcile-preview",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      limit: 26,
    },
  });
  assert.equal(badLimit.statusCode, 400);

  const ok = await app.inject({
    method: "POST",
    url: "/admin/v1/leadcapture/trust/pilot/reconcile-preview",
    headers: { [HEADER]: "admin-secret" },
    payload: {
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      limit: 25,
    },
  });
  assert.equal(ok.statusCode, 200);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
