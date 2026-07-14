import test from "node:test";
import assert from "node:assert/strict";

import { buildLeadCaptureTrustPacketFromApiRecord } from "../leadcapture-data-api/leadcapture-trust-packet.js";
import {
  applyCorrelationToPacket,
  type LeadCaptureTrustCorrelationResult,
} from "./leadcapture-trust-correlation.service.js";
import { LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY } from "./leadcapture-trust.constants.js";

const baseRecord = {
  submitted_at: "2026-06-16T11:25:41.000Z",
  disclosure_text: "Consent text",
  disclosure_version: "v1",
  tcpa_consent: true,
  verfi_proof_url: "https://verfi.example.test/proof/1",
  leadproof_hash: "hash-1",
  _meta: { lead_id: "lead-abc", funnel_id: "23381" },
};

test("applyCorrelation exact_match enables canAttach", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(baseRecord);
  const correlation: LeadCaptureTrustCorrelationResult = {
    classification: "exact_match",
    matchedEvent: {
      id: "evt_1",
      sourceRouteKey: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
      clientAccountIdResolved: "vet_life_james_torrey",
      sourceProvider: "leadcapture_io",
      normalizedPayloadJson: { contact: { lead_uid: "leadcaptureio-leadcapture_io_legacy-lead-abc" } },
    } as never,
    blockers: [],
  };
  const applied = applyCorrelationToPacket(packet, correlation);
  assert.equal(applied.assessment.correlationClassification, "exact_match");
  assert.equal(applied.assessment.canAttach, true);
  assert.equal(applied.correlation.sourceLeadEventId, "evt_1");
});

test("applyCorrelation preview_identity_match blocks attach", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(baseRecord);
  const correlation: LeadCaptureTrustCorrelationResult = {
    classification: "preview_identity_match",
    matchedEvent: {
      id: "evt_preview",
      sourceRouteKey: LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
      clientAccountIdResolved: "vet_life_james_torrey",
      sourceProvider: "leadcapture_io",
      normalizedPayloadJson: { contact: { lead_uid: "leadcaptureio-leadcapture_io_legacy-lead-abc" } },
    } as never,
    blockers: ["preview_only_identity_match_requires_explicit_source_lead_event_id"],
  };
  const applied = applyCorrelationToPacket(packet, correlation);
  assert.equal(applied.assessment.canAttach, false);
  assert.equal(applied.assessment.blockers.includes("preview_only_identity_match_requires_explicit_source_lead_event_id"), true);
});

test("applyCorrelation ambiguous blocks attach", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(baseRecord);
  const applied = applyCorrelationToPacket(packet, {
    classification: "ambiguous",
    matchedEvent: null,
    blockers: ["multiple_provider_lead_id_matches"],
  });
  assert.equal(applied.assessment.canAttach, false);
  assert.equal(applied.assessment.correlationClassification, "ambiguous");
});

test("applyCorrelation campaign_mismatch blocks attach", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(baseRecord);
  const applied = applyCorrelationToPacket(packet, {
    classification: "campaign_mismatch",
    matchedEvent: null,
    blockers: ["provider_lead_campaign_mismatch"],
  });
  assert.equal(applied.assessment.canAttach, false);
});
