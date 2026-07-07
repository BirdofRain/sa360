import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractLeadProofPacket } from "./lead-proof.service.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/sa360-demo-lead-created.json"
);

test("Facebook lead form proof extraction maps source lane to meta_lead_ads", () => {
  const payload = JSON.parse(readFileSync(fixturePath, "utf8"));
  const extracted = extractLeadProofPacket(payload);
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.equal(extracted.proofPacket.sourceLane, "meta_lead_ads");
  assert.equal(extracted.proofPacket.sourcePlatform, "facebook");
  assert.equal(extracted.proofPacket.sourceType, "facebook_lead_form");
  assert.equal(extracted.proofPacket.campaignId, "120241930690720364");
  assert.ok(["PROOF_MISSING", "NEEDS_REVIEW"].includes(extracted.proofPacket.proofStatus));
});

test("LeadCapture.io proof extraction maps lane and tolerates minimal payload", () => {
  const extracted = extractLeadProofPacket({
    contact: { lead_uid: "lc-test-001" },
    attribution: { source_platform: "leadcapture.io", source_type: "landing_page_form" },
    routing: {
      source_intake: {
        sourceAttributes: {
          source_platform: "leadcapture_io",
          source_type: "landing_page_form",
          route_key: "vet_fex",
        },
      },
    },
  });
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.equal(extracted.proofPacket.sourceLane, "leadcapture_io");
  assert.equal(extracted.proofPacket.sourcePlatform, "leadcapture.io");
  assert.equal(extracted.sourceSnapshot.sourceAttributes?.route_key, "vet_fex");
});

test("Missing proof fields returns proof missing or needs review without throw", () => {
  const extracted = extractLeadProofPacket({
    contact: { lead_uid: "proof-missing-001", phone_e164: "+15550001111" },
    attribution: { source_platform: "facebook", source_type: "facebook_lead_form" },
  });
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.ok(["PROOF_MISSING", "NEEDS_REVIEW", "UNREVIEWED"].includes(extracted.proofPacket.proofStatus));
  assert.ok(extracted.missingProofFields.length > 0);
});

test("Unknown source still creates proof shell when leadUid exists", () => {
  const extracted = extractLeadProofPacket({
    contact: { lead_uid: "unknown-source-001" },
  });
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.equal(extracted.proofPacket.sourceLane, "unknown");
  assert.equal(extracted.proofPacket.leadUid, "unknown-source-001");
});

test("Complete proof fields with known lane can reach PROOF_ATTACHED", () => {
  const extracted = extractLeadProofPacket({
    contact: { lead_uid: "proof-complete-001", phone_e164: "+15550001111" },
    attribution: {
      source_platform: "facebook",
      source_type: "facebook_lead_form",
      form_id: "form-123",
      form_name: "Solar Lead Form",
    },
    source_lead_id: "fb-lead-999",
    consent: {
      consent_text: "I agree to be contacted.",
      consent_version: "2026-06-v1",
    },
    submitted_at: "2026-06-30T12:00:00.000Z",
  });
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.equal(extracted.proofPacket.sourceLane, "meta_lead_ads");
  assert.equal(extracted.proofPacket.proofStatus, "PROOF_ATTACHED");
  assert.equal(extracted.missingProofFields.length, 0);
});

test("LeadCapture extraction emits integrity + TrustedForm artifacts when present", () => {
  const extracted = extractLeadProofPacket({
    contact: { lead_uid: "lc-artifacts-001", phone_e164: "+15550001111" },
    attribution: {
      source_platform: "leadcapture_io",
      source_type: "leadcapture_form",
    },
    source_lead_id: "lc-001",
    consent: {
      consent_text: "I agree to be contacted.",
      consent_version: "2026-07-v1",
    },
    submitted_at: "2026-07-07T10:00:00.000Z",
    routing: {
      source_intake: {
        sourceAttributes: {
          trustedform_cert_url: "https://cert.trustedform.example.test/lc-001",
        },
        compliance: {
          verfi_proof_url: "https://verfi.example.test/proof/lc-001",
        },
      },
    },
  });
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.equal(extracted.proofPacket.proofStatus, "PROOF_ATTACHED");
  assert.equal(extracted.extractedArtifacts.length, 2);
  assert.ok(
    extracted.extractedArtifacts.some(
      (artifact) =>
        artifact.provider === "leadcapture_io" &&
        artifact.artifactType === "CRYPTOGRAPHIC_INTEGRITY"
    )
  );
  const trustedFormArtifact = extracted.extractedArtifacts.find(
    (artifact) => artifact.provider === "trustedform" && artifact.artifactType === "CONSENT_CERTIFICATE"
  );
  assert.ok(trustedFormArtifact);
  assert.equal(trustedFormArtifact?.certificateUrl, "https://cert.trustedform.example.test/lc-001");
  assert.deepEqual(trustedFormArtifact?.providerMetadata, {});
  const integrityArtifact = extracted.extractedArtifacts.find(
    (artifact) =>
      artifact.provider === "leadcapture_io" && artifact.artifactType === "CRYPTOGRAPHIC_INTEGRITY"
  );
  assert.ok(integrityArtifact);
  assert.deepEqual(integrityArtifact?.providerMetadata, {
    signal: "verfi_proof_url",
  });
  assert.ok(
    extracted.extractedArtifacts.every((artifact) => artifact.failureReasons === null)
  );
});

test("LeadCapture missing integrity artifact is downgraded to review/missing", () => {
  const extracted = extractLeadProofPacket({
    contact: { lead_uid: "lc-artifacts-002", phone_e164: "+15550001112" },
    attribution: {
      source_platform: "leadcapture_io",
      source_type: "leadcapture_form",
      form_id: "lc-form-1",
    },
    source_lead_id: "lc-002",
    consent: {
      consent_text: "I agree to be contacted.",
      consent_version: "2026-07-v1",
    },
    submitted_at: "2026-07-07T10:00:00.000Z",
    routing: {
      source_intake: {
        sourceAttributes: {
          trustedform_cert_url: "https://cert.trustedform.example.test/lc-002",
        },
      },
    },
  });
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.equal(extracted.proofPacket.sourceLane, "leadcapture_io");
  assert.equal(extracted.proofPacket.proofStatus, "NEEDS_REVIEW");
  assert.ok(extracted.missingProofFields.includes("artifact:CRYPTOGRAPHIC_INTEGRITY"));
});

test("artifact extraction is idempotent for duplicate TrustedForm signals", () => {
  const extracted = extractLeadProofPacket({
    contact: { lead_uid: "lc-artifacts-003" },
    attribution: { source_platform: "leadcapture_io", source_type: "leadcapture_form" },
    routing: {
      source_intake: {
        sourceAttributes: {
          trustedform_cert_url: "https://cert.trustedform.example.test/dup-001",
        },
        compliance: {
          trustedform_cert_url: "https://cert.trustedform.example.test/dup-001",
        },
      },
    },
  });
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  const trustedFormArtifacts = extracted.extractedArtifacts.filter(
    (artifact) => artifact.provider === "trustedform"
  );
  assert.equal(trustedFormArtifacts.length, 1);
});

test("TrustedForm certificate fingerprint normalization ignores case and trailing slash", () => {
  const first = extractLeadProofPacket({
    contact: { lead_uid: "lc-artifacts-004" },
    attribution: { source_platform: "leadcapture_io", source_type: "leadcapture_form" },
    routing: {
      source_intake: {
        sourceAttributes: {
          trustedform_cert_url: "HTTPS://CERT.TRUSTEDFORM.EXAMPLE.TEST/ABC123/",
        },
      },
    },
  });
  const second = extractLeadProofPacket({
    contact: { lead_uid: "lc-artifacts-005" },
    attribution: { source_platform: "leadcapture_io", source_type: "leadcapture_form" },
    routing: {
      source_intake: {
        sourceAttributes: {
          trustedform_cert_url: "https://cert.trustedform.example.test/abc123",
        },
      },
    },
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  const firstFingerprint = first.extractedArtifacts.find(
    (artifact) => artifact.provider === "trustedform"
  )?.artifactFingerprint;
  const secondFingerprint = second.extractedArtifacts.find(
    (artifact) => artifact.provider === "trustedform"
  )?.artifactFingerprint;
  assert.ok(firstFingerprint);
  assert.equal(firstFingerprint, secondFingerprint);
});
