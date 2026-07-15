import test, { after } from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/db.js";
import { fingerprintProviderLeadId } from "../services/leadcapture-data-api/leadcapture-trust-packet.js";
import {
  createLeadCaptureTrustSyncAuditEvent,
  findAppliedAttachAuditForProviderHash,
  findLatestAppliedAttachAuditForProvider,
} from "./leadcapture-trust-sync-audit.repository.js";

const suffix = `audit-${Date.now()}`;
const providerFingerprint = fingerprintProviderLeadId(`lead-${suffix}`);
const sourceLeadEventId = `evt_${suffix}`;
const createdAuditIds: string[] = [];

after(async () => {
  if (createdAuditIds.length === 0) return;
  await prisma.leadCaptureTrustSyncAuditEvent.deleteMany({ where: { id: { in: createdAuditIds } } });
});

test("applied attach audits preserve prior and new content hashes", async () => {
  const first = await createLeadCaptureTrustSyncAuditEvent({
    sourceLeadEventId,
    leadProofId: `proof_${suffix}`,
    providerLeadIdFingerprint: providerFingerprint,
    maskedProviderLeadId: "jt-l***0001",
    campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    formId: "d6f2157f-d612-441a-80af-88742ef084dc",
    clientAccountId: "vet_life_james_torrey",
    action: "ATTACH",
    priorContentHash: null,
    newContentHash: `hash-v1-${suffix}`,
    correlationClassification: "exact_match",
    previousProofStatus: null,
    newProofStatus: "PROOF_ATTACHED",
    reviewStatus: "applied",
    requestId: `req-v1-${suffix}`,
    operatorNote: "first attach",
  });
  createdAuditIds.push(first.id);

  const second = await createLeadCaptureTrustSyncAuditEvent({
    sourceLeadEventId,
    leadProofId: `proof_${suffix}`,
    providerLeadIdFingerprint: providerFingerprint,
    maskedProviderLeadId: "jt-l***0001",
    campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    formId: "d6f2157f-d612-441a-80af-88742ef084dc",
    clientAccountId: "vet_life_james_torrey",
    action: "ATTACH",
    priorContentHash: `hash-v1-${suffix}`,
    newContentHash: `hash-v2-${suffix}`,
    correlationClassification: "exact_match",
    previousProofStatus: "PROOF_ATTACHED",
    newProofStatus: "PROOF_ATTACHED",
    reviewStatus: "applied",
    requestId: `req-v2-${suffix}`,
    operatorNote: "second attach after provider change",
  });
  createdAuditIds.push(second.id);

  const latest = await findLatestAppliedAttachAuditForProvider(providerFingerprint);
  assert.ok(latest);
  assert.equal(latest?.newContentHash, `hash-v2-${suffix}`);
  assert.equal(latest?.priorContentHash, `hash-v1-${suffix}`);

  const v1Applied = await findAppliedAttachAuditForProviderHash(providerFingerprint, `hash-v1-${suffix}`);
  const v2Applied = await findAppliedAttachAuditForProviderHash(providerFingerprint, `hash-v2-${suffix}`);
  assert.ok(v1Applied);
  assert.ok(v2Applied);
  assert.notEqual(v1Applied?.id, v2Applied?.id);
});
