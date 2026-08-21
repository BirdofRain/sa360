import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeLeadCaptureReplayNormalizationInput,
  readOriginalAuthoritativeSubmittedAt,
} from "./leadcapture-replay-merge.js";

const T1 = "2026-08-18T14:37:03.545Z";
const T2 = "2026-08-18T15:16:48.000Z";
const LEAD_ID = "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11";

test("original submitted_at T1 wins over resend T2", () => {
  const merged = mergeLeadCaptureReplayNormalizationInput({
    latestPayload: {
      lead_id: LEAD_ID,
      submitted_at: T2,
      healthcare_profession: "Registered Nurse",
      lead_proof: { proof_url: "https://proof.example.test/new" },
    },
    originalRawPayload: {
      lead_id: LEAD_ID,
      submitted_at: T1,
      sa360_route_key: "LCIO_NG_NURSE_ANDRU_DURANSO",
    },
  });
  assert.equal(merged.submitted_at, T1);
  assert.equal(merged.lead_id, LEAD_ID);
  assert.equal(merged.sa360_route_key, "LCIO_NG_NURSE_ANDRU_DURANSO");
  assert.equal(merged.healthcare_profession, "Registered Nurse");
});

test("missing original submitted_at does not accept resend T2", () => {
  const merged = mergeLeadCaptureReplayNormalizationInput({
    latestPayload: {
      lead_id: LEAD_ID,
      submitted_at: T2,
      answers: { submitted_at: T2 },
    },
    originalRawPayload: { lead_id: LEAD_ID, niche_key: "NURSE" },
    originalSourceLeadId: LEAD_ID,
  });
  assert.equal(merged.submitted_at, undefined);
  assert.equal((merged.answers as { submitted_at?: string } | undefined)?.submitted_at, undefined);
  assert.equal(merged.lead_id, LEAD_ID);
  assert.equal(readOriginalAuthoritativeSubmittedAt({ lead_id: LEAD_ID }), undefined);
});

test("original lead_id and route identity override a resend identity change", () => {
  const merged = mergeLeadCaptureReplayNormalizationInput({
    latestPayload: {
      lead_id: "11111111-2222-4333-8444-555555555555",
      submitted_at: T2,
      sa360_route_key: "LCIO_NG_CHANGED",
    },
    originalRawPayload: {
      lead_id: LEAD_ID,
      submitted_at: T1,
      sa360_route_key: "LCIO_NG_NURSE_ANDRU_DURANSO",
      sa360_source_system: "leadcapture_io_nextgen",
    },
    originalSourceLeadId: LEAD_ID,
    originalSourceRouteKey: "LCIO_NG_NURSE_ANDRU_DURANSO",
  });
  assert.equal(merged.lead_id, LEAD_ID);
  assert.equal(merged.sa360_route_key, "LCIO_NG_NURSE_ANDRU_DURANSO");
  assert.equal(merged.sa360_source_system, "leadcapture_io_nextgen");
  assert.equal(merged.submitted_at, T1);
});
