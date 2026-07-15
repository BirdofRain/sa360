import test, { after } from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/db.js";
import {
  buildLeadCaptureTrustPacketFromApiRecord,
  fingerprintProviderLeadId,
} from "../leadcapture-data-api/leadcapture-trust-packet.js";
import type { LeadCaptureDataApiTransport } from "../leadcapture-data-api/leadcapture-data-api.types.js";
import { createLeadCaptureTrustSyncAuditEvent } from "../../repositories/leadcapture-trust-sync-audit.repository.js";
import { upsertLeadProof } from "../../repositories/lead-proof.repository.js";
import { buildLeadCaptureTrustReconcilePreview } from "./leadcapture-trust-reconcile-preview.service.js";
import {
  LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
  LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
} from "./leadcapture-trust.constants.js";

const campaignId = LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY;
const suffix = `reconcile-${Date.now()}`;
const exactProviderLeadId = `jt-reconcile-${suffix}`;
const exactLeadUid = `leadcaptureio-leadcapture_io_legacy-${exactProviderLeadId}`;
const createdEventIds: string[] = [];
const createdAuditIds: string[] = [];
const createdLeadUids: string[] = [];

function saveTrustEnv() {
  return {
    enabled: process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED,
    campaigns: process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST,
    forms: process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST,
    token: process.env.SA360_LEADCAPTURE_DATA_API_TOKEN,
  };
}

function enableTrustEnv() {
  process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = "true";
  process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST = campaignId;
  process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST = "d6f2157f-d612-441a-80af-88742ef084dc";
  process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = "test-token";
}

function restoreTrustEnv(saved: ReturnType<typeof saveTrustEnv>) {
  if (saved.enabled === undefined) delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  else process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = saved.enabled;
  if (saved.campaigns === undefined) delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST;
  else process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST = saved.campaigns;
  if (saved.forms === undefined) delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST;
  else process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST = saved.forms;
  if (saved.token === undefined) delete process.env.SA360_LEADCAPTURE_DATA_API_TOKEN;
  else process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = saved.token;
}

after(async () => {
  if (createdAuditIds.length > 0) {
    await prisma.leadCaptureTrustSyncAuditEvent.deleteMany({ where: { id: { in: createdAuditIds } } });
  }
  if (createdLeadUids.length > 0) {
    await prisma.leadProof.deleteMany({ where: { leadUid: { in: createdLeadUids } } });
  }
  if (createdEventIds.length > 0) {
    await prisma.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
  }
});

test("reconcile preview reports truthful mixed page counts", async () => {
  const env = saveTrustEnv();
  enableTrustEnv();

  const exactEvent = await prisma.sourceLeadEvent.create({
    data: {
      sourceLeadId: exactProviderLeadId,
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_legacy",
      sourceType: "webhook",
      sourceRouteKey: campaignId,
      clientAccountIdResolved: LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
      rawPayloadJson: { suffix },
      normalizedPayloadJson: {
        contact: { lead_uid: exactLeadUid },
      },
    },
  });
  createdEventIds.push(exactEvent.id);

  const exactPacket = buildLeadCaptureTrustPacketFromApiRecord({
    submitted_at: "2026-06-16T11:25:41.000Z",
    consent_timestamp: "2026-06-16T11:25:41.000Z",
    disclosure_text: "Consent text",
    disclosure_version: "v1",
    tcpa_consent: true,
    verfi_proof_url: "https://verfi.example.test/proof/reconcile",
    leadproof_hash: "hash-reconcile",
    sa360_route_key: campaignId,
    ip_address: "203.0.113.10",
    user_agent: "Mozilla/5.0",
    _meta: { lead_id: exactProviderLeadId, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
  });

  await upsertLeadProof({
    leadUid: exactLeadUid,
    sourceLane: "leadcapture_io",
    proofStatus: "NEEDS_REVIEW",
    proofMissingReasons: ["artifact pending"],
    ipAddress: exactPacket.trustEvidence.ipAddress,
    userAgent: exactPacket.trustEvidence.userAgent,
  });
  createdLeadUids.push(exactLeadUid);

  const changedHash = `${exactPacket.integrity.contentHash}-changed`;
  const audit = await createLeadCaptureTrustSyncAuditEvent({
    sourceLeadEventId: exactEvent.id,
    leadProofId: (await prisma.leadProof.findUnique({ where: { leadUid: exactLeadUid } }))!.id,
    providerLeadIdFingerprint: fingerprintProviderLeadId(exactProviderLeadId),
    maskedProviderLeadId: "jt-l***0001",
    campaignId,
    formId: "d6f2157f-d612-441a-80af-88742ef084dc",
    clientAccountId: LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
    action: "ATTACH",
    priorContentHash: null,
    newContentHash: changedHash,
    correlationClassification: "exact_match",
    previousProofStatus: null,
    newProofStatus: "PROOF_ATTACHED",
    reviewStatus: "applied",
    requestId: `req-${suffix}`,
    operatorNote: "prior attach with old hash",
  });
  createdAuditIds.push(audit.id);

  const transport: LeadCaptureDataApiTransport = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            submitted_at: "2026-06-16T11:25:41.000Z",
            consent_timestamp: "2026-06-16T11:25:41.000Z",
            disclosure_text: "Consent text",
            disclosure_version: "v1",
            tcpa_consent: true,
            verfi_proof_url: "https://verfi.example.test/proof/reconcile",
            leadproof_hash: "hash-reconcile",
            sa360_route_key: campaignId,
            _meta: { lead_id: exactProviderLeadId, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
          },
          {
            submitted_at: "2026-06-16T11:25:41.000Z",
            sa360_route_key: campaignId,
            _meta: { lead_id: `unmatched-${suffix}`, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
          },
          {
            submitted_at: "2026-06-16T11:25:41.000Z",
            sa360_route_key: campaignId,
            _meta: { funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
          },
          {
            submitted_at: "2026-06-16T11:25:41.000Z",
            sa360_route_key: campaignId,
            _meta: { lead_id: `wrong-form-${suffix}`, funnel_id: "99999" },
          },
        ],
        next_cursor: null,
        has_more: false,
      }),
      { status: 200 }
    );

  const result = await buildLeadCaptureTrustReconcilePreview({
    campaignId,
    transport,
  });

  restoreTrustEnv(env);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.counts.providerLeadsRead, 4);
  assert.equal(result.counts.exactMatches, 1);
  assert.equal(result.counts.unmatched, 1);
  assert.equal(result.counts.providerErrors, 1);
  assert.equal(result.counts.campaignMismatch, 1);
  assert.equal(result.counts.providerEvidenceChanged, 1);
  assert.equal(result.counts.alreadyAttached, 0);
  assert.equal(result.counts.completeProof, 1);
  assert.equal(result.counts.needsReview, 0);
  assert.equal(result.counts.proofMissing, 2);

  const exactRow = result.rows.find((row) => row.correlationClassification === "exact_match");
  assert.ok(exactRow);
  assert.equal(exactRow?.proofRecordPresent, true);
  assert.equal(exactRow?.alreadyAttached, false);
  assert.equal(exactRow?.providerEvidenceChanged, true);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("203.0.113.10"), false);
  assert.equal(serialized.includes("Mozilla/5.0"), false);
  assert.equal(serialized.includes(exactProviderLeadId), false);
});
