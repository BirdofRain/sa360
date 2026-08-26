import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { leadCaptureNextGenLeadCreatedSchema } from "./leadcapture-nextgen-webhook.schema.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/leadcaptureio");

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

function parse(payload: unknown) {
  return leadCaptureNextGenLeadCreatedSchema.safeParse(payload);
}

test("sanitized Madison NextGen body with null proof URLs now passes", () => {
  const fixture = loadFixture("leadcaptureio-webhook-sample-nextgen-madison-nulls.json");
  const parsed = parse(fixture);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.lead_id, "191f8688-0d85-4a93-a737-bc34c3df7dae");
  assert.equal(
    parsed.data.sa360_route_key,
    "LCIO_NEXTGEN_VET_LIFE_MADISON_PIMENTEL_V2_VET_FEX"
  );
  assert.equal(parsed.data.trustedform_cert_url, undefined);
  assert.equal(parsed.data.verfi_proof_url, undefined);
  assert.equal(parsed.data.niche, undefined);
  assert.equal(parsed.data.niche_key, undefined);
  assert.equal("niche" in fixture, false);
  assert.equal("niche_key" in fixture, false);
  assert.equal(fixture.trustedform_cert_url, null);
  assert.equal(fixture.verfi_proof_url, null);
});

test("optional provider strings accept missing, undefined, null, and valid strings", () => {
  const base = {
    lead_id: "191f8688-0d85-4a93-a737-bc34c3df7dae",
    sa360_route_key: "LCIO_NEXTGEN_VET_LIFE_MADISON_PIMENTEL_V2_VET_FEX",
  };
  assert.equal(parse(base).success, true);
  assert.equal(parse({ ...base, first_name: undefined }).success, true);
  assert.equal(parse({ ...base, first_name: null }).success, true);
  assert.equal(parse({ ...base, first_name: "Probe" }).success, true);
  assert.equal(parse({ ...base, trustedform_cert_url: null, verfi_proof_url: null }).success, true);
  assert.equal(
    parse({ ...base, trustedform_cert_url: "https://cert.example.test/ok" }).success,
    true
  );
});

test("required lead_id stays strict", () => {
  const route = { sa360_route_key: "LCIO_NEXTGEN_VET_LIFE_MADISON_PIMENTEL_V2_VET_FEX" };
  assert.equal(parse({ ...route, lead_id: "191f8688-0d85-4a93-a737-bc34c3df7dae" }).success, true);
  assert.equal(parse({ ...route }).success, false);
  assert.equal(parse({ ...route, lead_id: null }).success, false);
  assert.equal(parse({ ...route, lead_id: "" }).success, false);
  assert.equal(parse({ ...route, lead_id: "not-a-uuid" }).success, false);
  assert.equal(parse({ ...route, lead_id: "12345" }).success, false);
});

test("known optional fields reject wrong non-null types", () => {
  const base = { lead_id: "191f8688-0d85-4a93-a737-bc34c3df7dae" };
  assert.equal(parse({ ...base, first_name: {} }).success, false);
  assert.equal(parse({ ...base, email: [] }).success, false);
  assert.equal(parse({ ...base, phone: 12345 }).success, false);
  assert.equal(parse({ ...base, trustedform_cert_url: { url: "x" } }).success, false);
  assert.equal(parse({ ...base, verfi_proof_url: 1 }).success, false);
  assert.equal(parse({ ...base, tcpa_consent: { granted: true } }).success, false);
});

test("submitted_at keeps existing empty-string rejection and accepts null as absent", () => {
  const base = { lead_id: "191f8688-0d85-4a93-a737-bc34c3df7dae" };
  assert.equal(parse({ ...base, submitted_at: "2026-08-24T22:30:05.000Z" }).success, true);
  assert.equal(parse({ ...base, submitted_at: null }).success, true);
  assert.equal(parse({ ...base, submitted_at: "" }).success, false);
  assert.equal(parse({ ...base, submitted_at: "   " }).success, false);
});

test("Nurse NextGen fixture still passes unchanged", () => {
  const parsed = parse(loadFixture("leadcaptureio-webhook-sample-nextgen-nurse.json"));
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.sa360_route_key, "LCIO_NG_NURSE_ANDRU_DURANSO");
  assert.equal(parsed.data.niche, "NURSE");
  assert.equal(parsed.data.niche_key, "NURSE");
  assert.equal(parsed.data.lead_proof?.proof_url, "https://proof.example.test/leadcapture/nurse-canary-001");
});

test("lead_proof object remains optional and does not accept a bare null object", () => {
  const base = { lead_id: "191f8688-0d85-4a93-a737-bc34c3df7dae" };
  assert.equal(parse(base).success, true);
  assert.equal(parse({ ...base, lead_proof: null }).success, false);
  assert.equal(
    parse({
      ...base,
      lead_proof: {
        proof_url: null,
        integrity_hash: "sha256:abc",
        verification_key: "key",
      },
    }).success,
    true
  );
});
