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
    "leadcaptureio-leadcapture_io_nextgen-lc_demo_nextgen_001"
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
