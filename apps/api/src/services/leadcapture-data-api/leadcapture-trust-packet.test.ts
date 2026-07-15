import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeLeadCaptureTrustContentHash } from "./leadcapture-trust-content-hash.js";
import {
  buildLeadCaptureTrustPacketFromApiRecord,
  presentLeadCaptureTrustPreviewSummary,
} from "./leadcapture-trust-packet.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const completeFixture = JSON.parse(
  readFileSync(join(__dirname, "../../fixtures/leadcapture-data-api/leadcapture-data-api-lead-complete.json"), "utf8")
);

function baseHashInput() {
  return {
    identity: {
      providerLeadId: "lead-1",
      providerSubmissionId: "sub-1",
      providerCampaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      providerFormId: "d6f2157f-d612-441a-80af-88742ef084dc",
    },
    consent: {
      disclosureText: "Consent text",
      disclosureVersion: "v1",
      disclosureAccepted: true,
      consentTimestamp: "2026-06-16T11:25:41.000Z",
      submissionTimestamp: "2026-06-16T11:25:41.000Z",
    },
    sourceEvidence: {
      sourceUrl: "https://forms.example.test/page",
      ipAddress: "203.0.113.10",
      userAgent: "Mozilla/5.0",
    },
    complianceEvidence: {
      certificateId: "https://verfi.example.test/proof/1",
      certificateProvider: "verfi",
      integrityHash: "hash-1",
      providerVerificationStatus: "good",
      providerVersion: "1",
      sourceUpdatedAt: "2026-06-16T11:25:41.000Z",
    },
    trustAnswers: { "TCPA consent": "accepted" },
  };
}

test("resolveDisclosureAccepted parses native booleans and strings", () => {
  assert.equal(buildLeadCaptureTrustPacketFromApiRecord({ tcpa_consent: true, _meta: { lead_id: "a" } }).trustEvidence.disclosureAccepted, true);
  assert.equal(buildLeadCaptureTrustPacketFromApiRecord({ tcpa_consent: false, _meta: { lead_id: "a" } }).trustEvidence.disclosureAccepted, false);
  assert.equal(
    buildLeadCaptureTrustPacketFromApiRecord({ tcpa_consent_status: "verified", _meta: { lead_id: "a" } }).trustEvidence
      .disclosureAccepted,
    true
  );
  assert.equal(
    buildLeadCaptureTrustPacketFromApiRecord({ consent_accepted: "no", _meta: { lead_id: "a" } }).trustEvidence.disclosureAccepted,
    false
  );
  assert.equal(
    buildLeadCaptureTrustPacketFromApiRecord({ _meta: { lead_id: "a" } }).trustEvidence.disclosureAccepted,
    null
  );
});

test("complete fixture produces consentAccepted yes in preview summary", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(completeFixture);
  const summary = presentLeadCaptureTrustPreviewSummary({
    packet,
    proofRecordPresent: false,
    sourceSnapshotPresent: false,
    artifactCount: 1,
  });
  assert.equal(summary.consentAccepted, "yes");
});

test("preview summary reports Data API funnel UUID without exposing PII", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(completeFixture);
  const summary = presentLeadCaptureTrustPreviewSummary({
    packet,
    proofRecordPresent: false,
    sourceSnapshotPresent: false,
    artifactCount: 1,
  });
  assert.equal(summary.providerFormId, "d6f2157f-d612-441a-80af-88742ef084dc");
  assert.equal(summary.providerFormId?.includes("23381"), false);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("redacted@example.com"), false);
  assert.equal(serialized.includes("+15550103903"), false);
  assert.equal(serialized.includes("203.0.113.10"), false);
  assert.equal("ipAddress" in summary, false);
  assert.equal("email" in summary, false);
  assert.equal("phone" in summary, false);
});

test("content hash changes when evidence fields change", () => {
  const base = baseHashInput();
  const original = computeLeadCaptureTrustContentHash(base);
  assert.notEqual(
    original,
    computeLeadCaptureTrustContentHash({
      ...base,
      consent: { ...base.consent, disclosureText: "Different consent text" },
    })
  );
  assert.notEqual(
    original,
    computeLeadCaptureTrustContentHash({
      ...base,
      consent: { ...base.consent, disclosureAccepted: false },
    })
  );
  assert.notEqual(
    original,
    computeLeadCaptureTrustContentHash({
      ...base,
      consent: { ...base.consent, consentTimestamp: "2026-06-17T11:25:41.000Z" },
    })
  );
  assert.notEqual(
    original,
    computeLeadCaptureTrustContentHash({
      ...base,
      sourceEvidence: { ...base.sourceEvidence, sourceUrl: "https://other.example.test" },
    })
  );
  assert.notEqual(
    original,
    computeLeadCaptureTrustContentHash({
      ...base,
      sourceEvidence: { ...base.sourceEvidence, ipAddress: "203.0.113.11" },
    })
  );
  assert.notEqual(
    original,
    computeLeadCaptureTrustContentHash({
      ...base,
      sourceEvidence: { ...base.sourceEvidence, userAgent: "OtherAgent/1.0" },
    })
  );
  assert.notEqual(
    original,
    computeLeadCaptureTrustContentHash({
      ...base,
      complianceEvidence: {
        ...base.complianceEvidence,
        certificateId: "https://verfi.example.test/proof/2",
      },
    })
  );
  assert.notEqual(
    original,
    computeLeadCaptureTrustContentHash({
      ...base,
      complianceEvidence: { ...base.complianceEvidence, integrityHash: "hash-2" },
    })
  );
  assert.notEqual(
    original,
    computeLeadCaptureTrustContentHash({
      ...base,
      complianceEvidence: { ...base.complianceEvidence, providerVersion: "2" },
    })
  );
  assert.notEqual(
    original,
    computeLeadCaptureTrustContentHash({
      ...base,
      trustAnswers: { "TCPA consent": "declined" },
    })
  );
});

test("identical evidence with different object key order hashes equally", () => {
  const a = computeLeadCaptureTrustContentHash({
    ...baseHashInput(),
    trustAnswers: { alpha: "1", beta: "2" },
  });
  const b = computeLeadCaptureTrustContentHash({
    ...baseHashInput(),
    trustAnswers: { beta: "2", alpha: "1" },
  });
  assert.equal(a, b);
});

test("complete fixture persists actual ip and user agent in packet", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(completeFixture);
  assert.equal(packet.trustEvidence.ipAddress, "203.0.113.10");
  assert.equal(packet.trustEvidence.userAgent, "Mozilla/5.0");
  const summary = presentLeadCaptureTrustPreviewSummary({
    packet,
    proofRecordPresent: false,
    sourceSnapshotPresent: false,
    artifactCount: 1,
  });
  assert.equal(summary.ipPresent, true);
  assert.equal("ipAddress" in summary, false);
  assert.equal("userAgent" in summary, false);
});
