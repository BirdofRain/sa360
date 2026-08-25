import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  normalizeLeadCaptureIoWebhookToLifecyclePayload,
  inferLeadCaptureIoRoutingKeys,
} from "./leadcapture-io-normalizer.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/leadcaptureio");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

test("normalizer creates MASTER 2.0 legacy payload", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy.json");
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal(normalized.schema_version, "MASTER 2.0");
  assert.equal(normalized.client_account_id, "leadcapture_io");
  assert.equal(normalized.event.event_name_internal, "lead_created");
  assert.equal(normalized.event.send_to_meta, false);
  assert.equal(normalized.attribution?.source_platform, "leadcapture_io");
  assert.equal(normalized.attribution?.source_type, "leadcapture_form");
  assert.equal(normalized.attribution?.campaign_id, "LC_VET_FEX_TEST");
  assert.match(normalized.event.event_uuid, /^LCIO-leadcapture_io_legacy-LC_VET_FEX_TEST-lead_created-/);
  assert.equal(
    normalized.contact.lead_uid,
    "leadcaptureio-leadcapture_io_legacy-lc_demo_legacy_001"
  );
  const parsed = lifecycleEventSchema.safeParse(normalized);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.flatten()));
});

test("normalizer distinguishes nextgen source_system", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-nextgen.json");
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.match(normalized.event.event_uuid, /^LCIO-leadcapture_io_nextgen-/);
  assert.equal(
    normalized.contact.lead_uid,
    "leadcaptureio-leadcapture_io_nextgen-11111111-2222-4333-8444-555555555555"
  );
  const routing = normalized.routing as Record<string, unknown> | undefined;
  const intake = routing?.source_intake as Record<string, unknown> | undefined;
  assert.equal(intake?.source_system, "leadcapture_io_nextgen");
});

test("event_uuid is stable for same inputs", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy.json");
  const a = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  const b = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal(a.event.event_uuid, b.event.event_uuid);
});

test("inferLeadCaptureIoRoutingKeys maps route key to campaign_id", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy.json");
  const keys = inferLeadCaptureIoRoutingKeys(raw);
  assert.equal(keys.campaignId, "LC_VET_FEX_TEST");
  assert.equal(keys.sourceProvider, "leadcapture_io");
});

test("normalizer preserves compliance fields in routing metadata", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy.json");
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  const routing = normalized.routing as Record<string, unknown>;
  const intake = routing.source_intake as Record<string, unknown>;
  const compliance = intake.compliance as Record<string, unknown>;
  assert.equal(compliance.military_status, "veteran");
  assert.equal(compliance.trustedform_cert_url, "https://cert.trustedform.example.test/legacy-001");
});

test("fixture PII uses example.test domain only", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy.json");
  const json = JSON.stringify(raw);
  assert.match(json, /@example\.test/);
  assert.doesNotMatch(json, /@gmail\.com|@yahoo\.com/);
});

function sourceIntake(normalized: ReturnType<typeof normalizeLeadCaptureIoWebhookToLifecyclePayload>) {
  const routing = normalized.routing as Record<string, unknown> | undefined;
  return routing?.source_intake as Record<string, unknown> | undefined;
}

test("legacy VET fixture stays VET with Veteran / Final Expense defaults", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy.json");
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal(normalized.state.lead_type, "VET");
  assert.equal((normalized.routing as { niche_key?: string }).niche_key, "VET");
  assert.equal((normalized.routing as { niche_label?: string }).niche_label, "Veteran");
  assert.equal((normalized.routing as { product_type?: string }).product_type, "Final Expense");
});

test("live legacy route-only VET with no explicit niche stays VET", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-route-vet.json");
  assert.equal(raw.niche_key, undefined);
  assert.equal(raw.niche, undefined);
  assert.equal(raw.sa360_source_system, "leadcapture_io_legacy");
  assert.equal(raw.sa360_route_key, "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX");

  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal(normalized.state.lead_type, "VET");
  assert.equal((normalized.routing as { niche_key?: string }).niche_key, "VET");
  assert.equal((normalized.routing as { niche_label?: string }).niche_label, "Veteran");
  assert.equal((normalized.routing as { product_type?: string }).product_type, "Final Expense");
});

test("explicit NURSE wins over a conflicting legacy VET route", () => {
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_route_key: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    lead_id: "11111111-2222-4333-8444-555555555555",
    submitted_at: "2026-08-18T14:37:03.545Z",
    niche_key: "NURSE",
    first_name: "Pat",
    last_name: "Lead",
    email: "pat.lead@example.test",
    phone: "5550108002",
    state: "NC",
  });
  assert.equal(normalized.state.lead_type, "NURSE");
  assert.equal((normalized.routing as { niche_key?: string }).niche_key, "NURSE");
  assert.notEqual((normalized.routing as { niche_label?: string }).niche_label, "Veteran");
});

test("NextGen VET fixture stays VET", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-nextgen.json");
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal(normalized.state.lead_type, "VET");
  assert.equal((normalized.routing as { niche_key?: string }).niche_key, "VET");
});

test("NextGen recognized niches do not become VET or Final Expense", () => {
  const cases = ["NURSE", "MORTGAGE", "TRUCKER", "HEALTH"] as const;
  for (const niche of cases) {
    const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload({
      provider: "leadcapture_io",
      sa360_source_system: "leadcapture_io_nextgen",
      sa360_route_key: `LCIO_NG_${niche}_TEST`,
      lead_id: "11111111-2222-4333-8444-555555555555",
      submitted_at: "2026-08-18T14:37:03.545Z",
      niche_key: niche,
      first_name: "Pat",
      last_name: "Lead",
      email: "pat.lead@example.test",
      phone: "5550108002",
      state: "NC",
    });
    assert.equal(normalized.state.lead_type, niche, niche);
    assert.equal((normalized.routing as { niche_key?: string }).niche_key, niche, niche);
    assert.notEqual((normalized.routing as { niche_label?: string }).niche_label, "Veteran", niche);
    assert.notEqual((normalized.routing as { product_type?: string }).product_type, "Final Expense", niche);
  }
});

test("route-only Madison NEXTGEN VET resolves VET and does not invent proof URLs from nulls", () => {
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_route_key: "LCIO_NEXTGEN_VET_LIFE_MADISON_PIMENTEL_V2_VET_FEX",
    lead_id: "191f8688-0d85-4a93-a737-bc34c3df7dae",
    submitted_at: "2026-08-24T22:30:05.000Z",
    trustedform_cert_url: null,
    verfi_proof_url: null,
    first_name: "Probe",
    last_name: "MadisonCanary",
    email: "sa360.madison.nextgen.canary2@example.test",
    phone: "5550104477",
    state: "TX",
  });
  assert.equal(normalized.state.lead_type, "VET");
  assert.equal((normalized.routing as { niche_key?: string }).niche_key, "VET");
  assert.equal((normalized.routing as { niche_label?: string }).niche_label, "Veteran");
  const attrs = (normalized.routing as { source_intake?: { sourceAttributes?: Record<string, unknown> } })
    .source_intake?.sourceAttributes;
  assert.equal(attrs?.trustedform_cert_url, undefined);
  assert.equal(attrs?.verfi_proof_url, undefined);
});

test("missing niche does not become VET", () => {
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_route_key: "LCIO_NG_UNKNOWN",
    lead_id: "11111111-2222-4333-8444-555555555555",
    submitted_at: "2026-08-18T14:37:03.545Z",
    first_name: "Pat",
    last_name: "Lead",
    email: "pat.lead@example.test",
    phone: "5550108002",
    state: "NC",
  });
  assert.notEqual(normalized.state.lead_type, "VET");
  assert.equal(normalized.state.lead_type, undefined);
  assert.notEqual((normalized.routing as { niche_key?: string }).niche_key, "VET");
  assert.equal((normalized.routing as { niche_key?: string }).niche_key, undefined);
});

test("unknown niche does not become VET", () => {
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_route_key: "LCIO_NG_WIDGET",
    lead_id: "11111111-2222-4333-8444-555555555555",
    submitted_at: "2026-08-18T14:37:03.545Z",
    niche_key: "WIDGET",
    first_name: "Pat",
    last_name: "Lead",
    email: "pat.lead@example.test",
    phone: "5550108002",
    state: "NC",
  });
  assert.notEqual(normalized.state.lead_type, "VET");
  assert.notEqual((normalized.routing as { niche_key?: string }).niche_key, "VET");
});

test("Nurse canary fixture normalizes NURSE context and keeps unknown passthrough fields", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-nextgen-nurse.json");
  const json = JSON.stringify(raw);
  assert.match(json, /@example\.test/);
  assert.doesNotMatch(json, /@gmail\.com|@yahoo\.com/);

  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  const routing = normalized.routing as Record<string, unknown>;
  const intake = sourceIntake(normalized);
  const attrs = intake?.sourceAttributes as Record<string, unknown>;
  const unmapped = intake?.unmappedSourceFieldsJson as Array<{ key: string; value: unknown }>;

  assert.equal(normalized.state.lead_type, "NURSE");
  assert.equal(routing.niche_key, "NURSE");
  assert.notEqual(routing.niche_label, "Veteran");
  assert.notEqual(routing.product_type, "Final Expense");
  assert.equal(intake?.submitted_at, "2026-08-18T14:37:03.545Z");
  assert.equal(intake?.generated_at, "2026-08-18T14:37:03.545Z");
  assert.equal(attrs.healthcare_profession, "Registered Nurse");
  assert.equal(attrs.primary_concern, "Income protection");
  assert.equal(attrs.desired_coverage, "250000");
  assert.equal(attrs.beneficiary, "Spouse Example");
  assert.equal(attrs.date_of_birth, "1988-04-12");
  assert.equal(attrs.best_time_to_call, "evening");
  assert.ok(unmapped.some((field) => field.key === "type_of_coverage" && field.value === "term_life"));
  assert.ok(unmapped.some((field) => field.key === "custom_nextgen_note"));
  assert.equal((intake?.lead_proof as { proof_url?: string } | undefined)?.proof_url, "https://proof.example.test/leadcapture/nurse-canary-001");

  const parsed = lifecycleEventSchema.safeParse(normalized);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.flatten()));
});
