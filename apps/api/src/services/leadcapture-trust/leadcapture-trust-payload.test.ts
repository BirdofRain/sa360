import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRestrictedTrustVaultPayload,
  containsPlaceholderEvidence,
  containsRawPii,
  redactProviderRecordForAdminSummary,
} from "./leadcapture-trust-payload.js";
import { buildLeadCaptureTrustPacketFromApiRecord } from "../leadcapture-data-api/leadcapture-trust-packet.js";

const nestedFixture = {
  _meta: { lead_id: "lead-nested-1", funnel_id: "23381" },
  sa360_route_key: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
  submitted_at: "2026-06-16T11:25:41.000Z",
  disclosure_text: "Consent text",
  disclosure_version: "v1",
  tcpa_consent: true,
  ip_address: "203.0.113.10",
  user_agent: "Mozilla/5.0",
  contact: {
    email: "nested@example.test",
    phone: "+15550103999",
    first_name: "Nested",
  },
  answers: {
    tcpa_consent_status: "verified",
    email: "nested@example.test",
  },
  deliveries: [{ response: { buyer: "Acme", contact_email: "buyer@example.test" } }],
};

test("restricted vault payload preserves actual restricted evidence values", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(nestedFixture);
  const payload = buildRestrictedTrustVaultPayload({
    packet,
    record: nestedFixture,
    integrityHash: packet.integrity.integrityHash,
  });
  assert.equal(payload.ip_address, "203.0.113.10");
  assert.equal(payload.user_agent, "Mozilla/5.0");
  assert.equal(payload.disclosure_text, "Consent text");
  assert.equal(containsPlaceholderEvidence(payload), false);
  assert.equal("email" in payload, false);
  assert.equal("phone" in payload, false);
});

test("admin summary redaction removes nested PII and disclosure bodies", () => {
  const redacted = redactProviderRecordForAdminSummary(nestedFixture);
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes("nested@example.test"), false);
  assert.equal(serialized.includes("+15550103999"), false);
  assert.equal(serialized.includes("Consent text"), false);
  assert.equal(serialized.includes("203.0.113.10"), false);
  assert.equal(serialized.includes("Mozilla/5.0"), false);
  assert.equal(containsRawPii(redacted), false);
});

test("preview and reconcile shaped responses stay clean for nested fixture", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(nestedFixture);
  const previewSummary = {
    maskedProviderLeadId: "jt-l***0001",
    ipPresent: Boolean(packet.trustEvidence.ipAddress),
    userAgentPresent: Boolean(packet.trustEvidence.userAgent),
    consentAccepted: packet.trustEvidence.disclosureAccepted ? "yes" : "no",
    contentHashPrefix: packet.integrity.contentHash.slice(0, 12),
  };
  const reconcileRow = {
    maskedProviderLeadId: "jt-l***0001",
    correlationClassification: "exact_match",
    completenessStatus: packet.assessment.completenessStatus,
    proofRecordPresent: true,
    alreadyAttached: false,
    providerEvidenceChanged: false,
    contentHashPrefix: packet.integrity.contentHash.slice(0, 12),
  };
  const auditRow = {
    maskedProviderLeadId: "jt-l***0001",
    priorContentHash: "priorhash123",
    newContentHash: packet.integrity.contentHash,
    operatorNote: "operator reviewed evidence",
  };

  for (const payload of [previewSummary, reconcileRow, auditRow]) {
    const serialized = JSON.stringify(payload);
    assert.equal(containsRawPii(payload), false);
    assert.equal(serialized.includes("nested@example.test"), false);
    assert.equal(serialized.includes("203.0.113.10"), false);
    assert.equal(serialized.includes("Mozilla/5.0"), false);
    assert.equal(containsPlaceholderEvidence(payload), false);
  }
});

test("vault persistence fields reject placeholder evidence strings", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(nestedFixture);
  const vaultFields = {
    ipAddress: packet.trustEvidence.ipAddress,
    userAgent: packet.trustEvidence.userAgent,
    consentText: packet.trustEvidence.disclosureText,
    consentVersion: packet.trustEvidence.disclosureVersion,
  };
  assert.equal(containsPlaceholderEvidence(vaultFields), false);
  assert.notEqual(vaultFields.ipAddress, "[RESTRICTED]");
  assert.notEqual(vaultFields.userAgent, "[REDACTED]");
});
