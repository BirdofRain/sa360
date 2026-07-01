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

  await upsertLeadVerificationResult({
    leadUid,
    verificationStatus: "UNCHECKED",
    duplicateStatus: "UNCHECKED",
  });
  const verificationAfterReingest = await getLeadVerificationResultByLeadUid(leadUid);
  assert.ok(verificationAfterReingest);
  assert.equal(verificationAfterReingest?.verificationStatus, "PASSED");
  assert.equal(verificationAfterReingest?.duplicateStatus, "UNIQUE");
});

test("nullable json fields handle null, undefined, and object/array payloads safely", async () => {
  const jsonLeadUid = `${leadUid}-json`;

  await upsertLeadProof({
    leadUid: jsonLeadUid,
    sourceLane: "meta_lead_ads",
    proofStatus: "NEEDS_REVIEW",
    proofMissingReasons: ["consentVersion missing"],
    rawSourcePayload: { source: "facebook" },
  });
  await upsertLeadProof({
    leadUid: jsonLeadUid,
    sourceLane: "meta_lead_ads",
    proofStatus: "NEEDS_REVIEW",
    proofMissingReasons: null,
    rawSourcePayload: null,
  });
  const proof = await getLeadProofByLeadUid(jsonLeadUid);
  assert.ok(proof);
  assert.equal(proof?.proofMissingReasons, null);
  assert.equal(proof?.rawSourcePayload, null);

  await upsertLeadSourceSnapshot({
    leadUid: jsonLeadUid,
    sourceAttributes: { campaign_id: "cmp-1" },
    routingAttributes: { niche_key: "fex" },
    rawPayload: { lead_uid: jsonLeadUid },
  });
  await upsertLeadSourceSnapshot({
    leadUid: jsonLeadUid,
    sourceAttributes: null,
    routingAttributes: null,
    rawPayload: null,
  });
  const snapshot = await prisma.leadSourceSnapshot.findUnique({ where: { leadUid: jsonLeadUid } });
  assert.ok(snapshot);
  assert.equal(snapshot?.sourceAttributes, null);
  assert.equal(snapshot?.routingAttributes, null);
  assert.equal(snapshot?.rawPayload, null);

  await upsertLeadVerificationResult({
    leadUid: jsonLeadUid,
    verificationStatus: "PASSED",
    duplicateStatus: "UNIQUE",
    reasons: { checks: ["phone", "email"] },
  });
  const verificationWithObject = await getLeadVerificationResultByLeadUid(jsonLeadUid);
  assert.ok(verificationWithObject);
  assert.deepEqual(verificationWithObject?.reasons, { checks: ["phone", "email"] });

  await upsertLeadVerificationResult({
    leadUid: jsonLeadUid,
    reasons: undefined,
  });
  const verificationWithUndefined = await getLeadVerificationResultByLeadUid(jsonLeadUid);
  assert.ok(verificationWithUndefined);
  assert.deepEqual(verificationWithUndefined?.reasons, { checks: ["phone", "email"] });

  await upsertLeadVerificationResult({
    leadUid: jsonLeadUid,
    reasons: null,
  });
  const verificationWithNull = await getLeadVerificationResultByLeadUid(jsonLeadUid);
  assert.ok(verificationWithNull);
  assert.equal(verificationWithNull?.reasons, null);

  await upsertLeadVerificationResult({
    leadUid: jsonLeadUid,
    reasons: ["queued_for_review"],
  });
  const verificationWithArray = await getLeadVerificationResultByLeadUid(jsonLeadUid);
  assert.ok(verificationWithArray);
  assert.deepEqual(verificationWithArray?.reasons, ["queued_for_review"]);

  await prisma.leadVerificationResult.deleteMany({ where: { leadUid: jsonLeadUid } });
  await prisma.leadSourceSnapshot.deleteMany({ where: { leadUid: jsonLeadUid } });
  await prisma.leadProof.deleteMany({ where: { leadUid: jsonLeadUid } });
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
