import test from "node:test";
import assert from "node:assert/strict";
import { applyProofRequirementPolicy } from "./proof-requirement-policy.registry.js";

test("leadconduit_facebook missing TrustedForm artifact remains incomplete", () => {
  const result = applyProofRequirementPolicy({
    sourceLane: "leadconduit_facebook",
    baselineStatus: "PROOF_ATTACHED",
    baselineMissingReasons: [],
    baselineMissingFields: [],
    extractedArtifacts: [],
  });
  assert.equal(result.proofStatus, "PROOF_MISSING");
  assert.ok(result.missingProofFields.includes("artifact:CONSENT_CERTIFICATE"));
});

test("leadconduit_facebook malformed TrustedForm evidence downgrades to needs review", () => {
  const result = applyProofRequirementPolicy({
    sourceLane: "leadconduit_facebook",
    baselineStatus: "PROOF_ATTACHED",
    baselineMissingReasons: [],
    baselineMissingFields: [],
    extractedArtifacts: [
      {
        provider: "trustedform",
        artifactType: "CONSENT_CERTIFICATE",
        status: "NEEDS_REVIEW",
        externalReference: "not-a-valid-url",
        certificateUrl: null,
        integrityHash: null,
        signature: null,
        algorithm: null,
        keyId: null,
        capturedAt: null,
        issuedAt: null,
        verifiedAt: null,
        retainedAt: null,
        expiresAt: null,
        artifactFingerprint: "fp-malformed-1",
        providerMetadata: { malformed_certificate_url: true },
        failureReasons: ["TrustedForm certificate URL malformed; review required."],
        rawArtifactPayload: { trustedform_cert_url: "not-a-valid-url" },
      },
    ],
  });
  assert.equal(result.proofStatus, "NEEDS_REVIEW");
  assert.ok(result.proofMissingReasons.some((reason) => reason.includes("CONSENT_CERTIFICATE")));
});
