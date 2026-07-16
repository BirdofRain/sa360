import test from "node:test";
import assert from "node:assert/strict";

import { fingerprintProviderLeadId } from "../leadcapture-data-api/leadcapture-trust-packet.js";
import { validateIdempotentReplay } from "./leadcapture-trust-attach.idempotency.js";

test("idempotent replay requires identical action, scope, and hash", () => {
  const replay = validateIdempotentReplay({
    audit: {
      id: "audit_1",
      action: "ATTACH",
      sourceLeadEventId: "evt_1",
      providerLeadIdFingerprint: fingerprintProviderLeadId("lead-1"),
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      formId: "d6f2157f-d612-441a-80af-88742ef084dc",
      leadProofId: "proof_1",
      newContentHash: "abc123hash",
      newProofStatus: "PROOF_ATTACHED",
      previousProofStatus: null,
    },
    sourceLeadEventId: "evt_1",
    providerLeadIdFingerprint: fingerprintProviderLeadId("lead-1"),
    campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    formId: "d6f2157f-d612-441a-80af-88742ef084dc",
    expectedContentHash: "abc123hash",
  });
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.reviewStatus, "idempotent_replay");
});

test("idempotent replay conflicts on different provider lead", () => {
  const replay = validateIdempotentReplay({
    audit: {
      id: "audit_1",
      action: "ATTACH",
      sourceLeadEventId: "evt_1",
      providerLeadIdFingerprint: fingerprintProviderLeadId("lead-1"),
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      formId: "d6f2157f-d612-441a-80af-88742ef084dc",
      leadProofId: "proof_1",
      newContentHash: "abc123hash",
      newProofStatus: "PROOF_ATTACHED",
      previousProofStatus: null,
    },
    sourceLeadEventId: "evt_1",
    providerLeadIdFingerprint: fingerprintProviderLeadId("lead-2"),
    campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    formId: "d6f2157f-d612-441a-80af-88742ef084dc",
    expectedContentHash: "abc123hash",
  });
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.error, "request_id_input_conflict");
});

test("idempotent replay conflicts on different hash", () => {
  const replay = validateIdempotentReplay({
    audit: {
      id: "audit_1",
      action: "ATTACH",
      sourceLeadEventId: "evt_1",
      providerLeadIdFingerprint: fingerprintProviderLeadId("lead-1"),
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      formId: "d6f2157f-d612-441a-80af-88742ef084dc",
      leadProofId: "proof_1",
      newContentHash: "abc123hash",
      newProofStatus: "PROOF_ATTACHED",
      previousProofStatus: null,
    },
    sourceLeadEventId: "evt_1",
    providerLeadIdFingerprint: fingerprintProviderLeadId("lead-1"),
    campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    formId: "d6f2157f-d612-441a-80af-88742ef084dc",
    expectedContentHash: "different-hash",
  });
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.error, "request_id_input_conflict");
});

test("idempotent replay conflicts on different campaign", () => {
  const replay = validateIdempotentReplay({
    audit: {
      id: "audit_1",
      action: "ATTACH",
      sourceLeadEventId: "evt_1",
      providerLeadIdFingerprint: fingerprintProviderLeadId("lead-1"),
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      formId: "d6f2157f-d612-441a-80af-88742ef084dc",
      leadProofId: "proof_1",
      newContentHash: "abc123hash",
      newProofStatus: "PROOF_ATTACHED",
      previousProofStatus: null,
    },
    sourceLeadEventId: "evt_1",
    providerLeadIdFingerprint: fingerprintProviderLeadId("lead-1"),
    campaignId: "OTHER_CAMPAIGN",
    formId: "d6f2157f-d612-441a-80af-88742ef084dc",
    expectedContentHash: "abc123hash",
  });
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.error, "request_id_input_conflict");
});

test("idempotent replay conflicts on different form", () => {
  const replay = validateIdempotentReplay({
    audit: {
      id: "audit_1",
      action: "ATTACH",
      sourceLeadEventId: "evt_1",
      providerLeadIdFingerprint: fingerprintProviderLeadId("lead-1"),
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      formId: "d6f2157f-d612-441a-80af-88742ef084dc",
      leadProofId: "proof_1",
      newContentHash: "abc123hash",
      newProofStatus: "PROOF_ATTACHED",
      previousProofStatus: null,
    },
    sourceLeadEventId: "evt_1",
    providerLeadIdFingerprint: fingerprintProviderLeadId("lead-1"),
    campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    formId: "99999",
    expectedContentHash: "abc123hash",
  });
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.error, "request_id_input_conflict");
});

test("idempotent replay conflicts on different action", () => {
  const replay = validateIdempotentReplay({
    audit: {
      id: "audit_1",
      action: "PREVIEW",
      sourceLeadEventId: "evt_1",
      providerLeadIdFingerprint: fingerprintProviderLeadId("lead-1"),
      campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      formId: "d6f2157f-d612-441a-80af-88742ef084dc",
      leadProofId: "proof_1",
      newContentHash: "abc123hash",
      newProofStatus: "PROOF_ATTACHED",
      previousProofStatus: null,
    },
    sourceLeadEventId: "evt_1",
    providerLeadIdFingerprint: fingerprintProviderLeadId("lead-1"),
    campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    formId: "d6f2157f-d612-441a-80af-88742ef084dc",
    expectedContentHash: "abc123hash",
  });
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.error, "request_id_action_conflict");
});
