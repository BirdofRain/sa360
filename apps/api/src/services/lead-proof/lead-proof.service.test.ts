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
