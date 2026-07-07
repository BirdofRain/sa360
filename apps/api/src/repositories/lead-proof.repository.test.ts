import assert from "node:assert/strict";
import test, { after } from "node:test";
import { prisma } from "../lib/db.js";
import {
  getLeadProofByLeadUid,
  getLeadProofOverviewSummary,
  getLeadVerificationResultByLeadUid,
  upsertLeadProof,
  upsertLeadProofArtifacts,
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

test("lead proof artifact upsert is idempotent and preserves first payload by fingerprint", async () => {
  const artifactLeadUid = `${leadUid}-artifact`;
  await upsertLeadProof({
    leadUid: artifactLeadUid,
    sourceLane: "leadcapture_io",
    proofStatus: "NEEDS_REVIEW",
    proofMissingReasons: ["artifact pending"],
  });
  const proof = await getLeadProofByLeadUid(artifactLeadUid);
  assert.ok(proof);

  const integrityFingerprint = "fp-integrity-001";
  await upsertLeadProofArtifacts([
    {
      leadProofId: proof!.id,
      provider: "leadcapture_io",
      artifactType: "CRYPTOGRAPHIC_INTEGRITY",
      externalReference: "https://verfi.example.test/proof/001",
      certificateUrl: null,
      integrityHash: "sha256-demo-hash",
      algorithm: "sha256",
      artifactFingerprint: integrityFingerprint,
      providerMetadata: { signal: "verfi_proof_url" },
      failureReasons: null,
      rawArtifactPayload: { signal: "verfi_proof_url", verfi_proof_url: "https://verfi.example.test/proof/001" },
    },
  ]);
  await upsertLeadProofArtifacts([
    {
      leadProofId: proof!.id,
      provider: "leadcapture_io",
      artifactType: "CRYPTOGRAPHIC_INTEGRITY",
      externalReference: "https://verfi.example.test/proof/001-overwrite-attempt",
      integrityHash: "attempted-overwrite",
      artifactFingerprint: integrityFingerprint,
      providerMetadata: { attempted: true },
      rawArtifactPayload: { signal: "overwrite_attempt" },
    },
  ]);
  await upsertLeadProofArtifacts([
    {
      leadProofId: proof!.id,
      provider: "trustedform",
      artifactType: "CONSENT_CERTIFICATE",
      externalReference: "https://cert.trustedform.example.test/001",
      certificateUrl: "https://cert.trustedform.example.test/001",
      artifactFingerprint: "fp-trustedform-001",
      providerMetadata: null,
      failureReasons: null,
      rawArtifactPayload: { trustedform_cert_url: "https://cert.trustedform.example.test/001" },
    },
  ]);

  const artifacts = await prisma.leadProofArtifact.findMany({
    where: { leadProofId: proof!.id },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(artifacts.length, 2);
  assert.equal(artifacts[0]?.artifactFingerprint, integrityFingerprint);
  assert.equal(artifacts[0]?.externalReference, "https://verfi.example.test/proof/001");
  assert.equal(artifacts[0]?.integrityHash, "sha256-demo-hash");
  assert.equal(artifacts[0]?.algorithm, "sha256");
  assert.deepEqual(artifacts[0]?.providerMetadata, { signal: "verfi_proof_url" });
  assert.equal(artifacts[0]?.failureReasons, null);
  assert.deepEqual(artifacts[0]?.rawArtifactPayload, {
    signal: "verfi_proof_url",
    verfi_proof_url: "https://verfi.example.test/proof/001",
  });
  assert.equal(artifacts[1]?.artifactType, "CONSENT_CERTIFICATE");
  assert.equal(artifacts[1]?.certificateUrl, "https://cert.trustedform.example.test/001");

  await prisma.leadProof.deleteMany({ where: { leadUid: artifactLeadUid } });
});

test("lead proof artifact supports nullable providerMetadata and failureReasons", async () => {
  const nullableLeadUid = `${leadUid}-artifact-nullable`;
  await upsertLeadProof({
    leadUid: nullableLeadUid,
    sourceLane: "leadcapture_io",
    proofStatus: "NEEDS_REVIEW",
    proofMissingReasons: ["artifact pending"],
  });
  const proof = await getLeadProofByLeadUid(nullableLeadUid);
  assert.ok(proof);

  await upsertLeadProofArtifacts([
    {
      leadProofId: proof!.id,
      provider: "trustedform",
      artifactType: "CONSENT_CERTIFICATE",
      externalReference: "https://cert.trustedform.example.test/nulls",
      certificateUrl: "https://cert.trustedform.example.test/nulls",
      artifactFingerprint: "fp-nullable-001",
      providerMetadata: null,
      failureReasons: null,
      rawArtifactPayload: { trustedform_cert_url: "https://cert.trustedform.example.test/nulls" },
    },
  ]);

  const artifact = await prisma.leadProofArtifact.findUnique({
    where: {
      leadProofId_artifactFingerprint: {
        leadProofId: proof!.id,
        artifactFingerprint: "fp-nullable-001",
      },
    },
  });
  assert.ok(artifact);
  assert.equal(artifact?.providerMetadata, null);
  assert.equal(artifact?.failureReasons, null);

  await prisma.leadProof.deleteMany({ where: { leadUid: nullableLeadUid } });
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
  const overviewProof = await getLeadProofByLeadUid(overviewLeadUid);
  assert.ok(overviewProof);
  await upsertLeadProofArtifacts([
    {
      leadProofId: overviewProof!.id,
      provider: "trustedform",
      artifactType: "CONSENT_CERTIFICATE",
      artifactFingerprint: "fp-overview-trustedform",
      externalReference: "https://cert.trustedform.example.test/overview",
      rawArtifactPayload: { trustedform_cert_url: "https://cert.trustedform.example.test/overview" },
    },
  ]);

  const summary = await getLeadProofOverviewSummary({ recentLimit: 5 });
  assert.ok(summary.totalLeads >= 1);
  assert.ok(summary.proofStatusCounts.PROOF_MISSING >= 1);
  assert.ok(summary.verificationStatusCounts.NEEDS_REVIEW >= 1);
  assert.ok(summary.recentIntake.some((row) => row.leadUid === overviewLeadUid));
  const overviewRow = summary.recentIntake.find((row) => row.leadUid === overviewLeadUid);
  assert.ok(overviewRow?.artifactSummary);
  assert.equal(overviewRow?.artifactSummary?.hasConsentCertificate, true);

  await prisma.leadVerificationResult.deleteMany({ where: { leadUid: overviewLeadUid } });
  await prisma.leadProof.deleteMany({ where: { leadUid: overviewLeadUid } });
});

after(async () => {
  await prisma.leadVerificationResult.deleteMany({ where: { leadUid } });
  await prisma.leadSourceSnapshot.deleteMany({ where: { leadUid } });
  await prisma.leadProof.deleteMany({ where: { leadUid } });
});
