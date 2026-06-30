import assert from "node:assert/strict";
import test, { after } from "node:test";
import { prisma } from "../lib/db.js";
import {
  getLeadProofByLeadUid,
  getLeadProofOverviewSummary,
  getLeadVerificationResultByLeadUid,
  upsertLeadProof,
  upsertLeadSourceSnapshot,
  upsertLeadVerificationResult,
} from "./lead-proof.repository.js";

const leadUid = `lf1-proof-${Date.now()}`;

test("lead proof repository upsert creates, updates, and reads by leadUid", async () => {
  await upsertLeadProof({
    leadUid,
    sourceLane: "meta_lead_ads",
    sourcePlatform: "facebook",
    sourceType: "facebook_lead_form",
    campaignName: "Proof Campaign A",
    formName: "Proof Form A",
    proofStatus: "NEEDS_REVIEW",
    proofMissingReasons: ["consentVersion missing"],
  });

  const first = await getLeadProofByLeadUid(leadUid);
  assert.ok(first);
  assert.equal(first?.campaignName, "Proof Campaign A");
  assert.equal(first?.proofStatus, "NEEDS_REVIEW");

  await upsertLeadProof({
    leadUid,
    sourceLane: "meta_lead_ads",
    sourcePlatform: "facebook",
    sourceType: "facebook_lead_form",
    campaignName: "Proof Campaign B",
    formName: "Proof Form B",
    proofStatus: "PROOF_ATTACHED",
    proofMissingReasons: [],
  });

  const second = await getLeadProofByLeadUid(leadUid);
  assert.ok(second);
  assert.equal(second?.campaignName, "Proof Campaign B");
  assert.equal(second?.formName, "Proof Form B");
  assert.equal(second?.proofStatus, "PROOF_ATTACHED");
});

test("lead source snapshot and verification result upserts are idempotent", async () => {
  await upsertLeadSourceSnapshot({
    leadUid,
    sourceLane: "meta_lead_ads",
    sourcePlatform: "facebook",
    sourceType: "facebook_lead_form",
    sourceAttributes: { campaign_id: "cmp-1" },
    routingAttributes: { niche_key: "fex" },
    rawPayload: { contact: { lead_uid: leadUid } },
  });

  await upsertLeadSourceSnapshot({
    leadUid,
    sourceLane: "meta_lead_ads",
    sourcePlatform: "facebook",
    sourceType: "facebook_lead_form",
    sourceAttributes: { campaign_id: "cmp-2" },
    routingAttributes: { niche_key: "fex" },
    rawPayload: { contact: { lead_uid: leadUid } },
  });

  const snapshot = await prisma.leadSourceSnapshot.findUnique({ where: { leadUid } });
  assert.ok(snapshot);
  assert.equal((snapshot?.sourceAttributes as { campaign_id?: string })?.campaign_id, "cmp-2");

  await upsertLeadVerificationResult({
    leadUid,
    verificationStatus: "UNCHECKED",
    duplicateStatus: "UNCHECKED",
    reasons: ["queued for verification"],
  });
  await upsertLeadVerificationResult({
    leadUid,
    verificationStatus: "PASSED",
    duplicateStatus: "UNIQUE",
    phoneStatus: "valid",
    emailStatus: "valid",
    suppressionStatus: "clear",
    reasons: [],
  });

  const verification = await getLeadVerificationResultByLeadUid(leadUid);
  assert.ok(verification);
  assert.equal(verification?.verificationStatus, "PASSED");
  assert.equal(verification?.duplicateStatus, "UNIQUE");
});

test("getLeadProofOverviewSummary aggregates proof and verification counts", async () => {
  const overviewLeadUid = `${leadUid}-overview`;
  await upsertLeadProof({
    leadUid: overviewLeadUid,
    sourceLane: "leadcapture_io",
    proofStatus: "PROOF_MISSING",
  });
  await upsertLeadVerificationResult({
    leadUid: overviewLeadUid,
    verificationStatus: "NEEDS_REVIEW",
    duplicateStatus: "UNCHECKED",
  });

  const summary = await getLeadProofOverviewSummary({ recentLimit: 5 });
  assert.ok(summary.totalLeads >= 1);
  assert.ok(summary.proofStatusCounts.PROOF_MISSING >= 1);
  assert.ok(summary.verificationStatusCounts.NEEDS_REVIEW >= 1);
  assert.ok(summary.recentIntake.some((row) => row.leadUid === overviewLeadUid));

  await prisma.leadVerificationResult.deleteMany({ where: { leadUid: overviewLeadUid } });
  await prisma.leadProof.deleteMany({ where: { leadUid: overviewLeadUid } });
});

after(async () => {
  await prisma.leadVerificationResult.deleteMany({ where: { leadUid } });
  await prisma.leadSourceSnapshot.deleteMany({ where: { leadUid } });
  await prisma.leadProof.deleteMany({ where: { leadUid } });
});
