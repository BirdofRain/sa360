import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  materializeLeadCapturePayload,
  resolveLeadCaptureField,
  resolveLeadCaptureLeadId,
} from "./leadcapture-payload-resolver.js";
import {
  normalizeLeadCaptureIoWebhookToLifecyclePayload,
} from "./leadcapture-io-normalizer.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/leadcaptureio");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

test("nested answers.lead_id is extracted", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-nested.json");
  const { leadId, sourceLeadIdGenerated } = resolveLeadCaptureLeadId(
    raw,
    "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX"
  );
  assert.equal(leadId, "jt-legacy-dryrun-002");
  assert.equal(sourceLeadIdGenerated, false);
});

test("nested name/phone/email are normalized into contact", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-nested.json");
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal(normalized.contact.first_name, "JamesDryRun");
  assert.equal(normalized.contact.last_name, "LeadTest002");
  assert.equal(normalized.contact.email, "sa360test+jt-legacy-dryrun-002@lifeagentlaunch.com");
  assert.equal(normalized.contact.phone_e164, "+15550103902");
  assert.equal(normalized.contact.state, "NC");
  assert.equal(
    normalized.contact.lead_uid,
    "leadcaptureio-leadcapture_io_legacy-jt-legacy-dryrun-002"
  );
});

test("nested survey fields become canonical sourceAttributes", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-nested.json");
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  const routing = normalized.routing as Record<string, unknown>;
  const intake = routing.source_intake as Record<string, unknown>;
  const attrs = intake.sourceAttributes as Record<string, unknown>;
  assert.equal(attrs.branch_of_service, "Army");
  assert.equal(attrs.desired_coverage, "$100,000+");
  assert.equal(attrs.best_time_to_call, "Afternoon");
  assert.equal(attrs.beneficiary, "Spouse");
  assert.equal(attrs.marital_status, "Married");
});

test("generated fallback identity is stable when lead_id is absent", () => {
  const raw = {
    provider: "leadcapture_io",
    sa360_source_platform: "leadcapture_io",
    sa360_route_key: "LC_TEST",
    answers: {
      email: "stable@example.test",
      phone: "+15550101001",
      submitted_at: "2026-06-16T12:00:00.000Z",
    },
  };
  const a = resolveLeadCaptureLeadId(raw, "LC_TEST");
  const b = resolveLeadCaptureLeadId(raw, "LC_TEST");
  assert.equal(a.sourceLeadIdGenerated, true);
  assert.equal(a.leadId, b.leadId);
  assert.match(a.leadId, /^gen-[a-f0-9]{16}$/);
  assert.notEqual(a.leadId, "unknown_lead");
});

test("no literal unknown_lead collision for nested payload", () => {
  const raw = loadFixture("leadcaptureio-webhook-sample-legacy-nested.json");
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.notEqual(normalized.contact.lead_uid, "leadcaptureio-leadcapture_io_legacy-unknown_lead");
  const intake = (normalized.routing as Record<string, unknown>).source_intake as Record<string, unknown>;
  assert.notEqual(intake.lead_id, "unknown_lead");
});

test("route key from path is applied when body omits sa360_route_key", () => {
  const raw = {
    provider: "leadcapture_io",
    answers: { lead_id: "path-route-001", first_name: "Path", phone: "+15550101002" },
  };
  const effective = materializeLeadCapturePayload(raw, {
    routeKeyFromPath: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
  });
  assert.equal(effective.sa360_route_key, "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX");
  assert.equal(resolveLeadCaptureField(raw, "lead_id"), "path-route-001");
});
