import assert from "node:assert/strict";
import { test } from "node:test";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCampaignNicheKey } from "../lead-inventory/campaign-inventory-tracking.service.js";
import { resolveInventoryGeneratedAt } from "../lead-inventory/lead-inventory-generated-at.js";
import { normalizeFacebookLeadToLifecyclePayload } from "./facebook-lead-normalizer.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "./leadcapture-io-normalizer.js";

test("Meta normalizer maps created_time into source-authoritative generated timestamp", () => {
  const payload = normalizeFacebookLeadToLifecyclePayload(
    {
      leadgenId: "lead_001",
      createdTime: "2026-03-15T12:00:00.000Z",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.test",
      phone: "+14155550100",
      state: "TX",
      campaignId: "camp_1",
      formId: "form_1",
    },
    { masterClientAccountId: "acct_1" }
  );
  const intake = (payload.routing as { source_intake?: Record<string, unknown> }).source_intake;
  assert.equal(intake?.created_time, "2026-03-15T12:00:00.000Z");
  assert.equal(intake?.generated_at, "2026-03-15T12:00:00.000Z");
  const resolved = resolveInventoryGeneratedAt({
    normalizedPayloadJson: payload as never,
    enrichmentMetadataJson: { sourceLane: "meta_lead_ads" },
    receivedAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  assert.equal(resolved.generatedAt?.toISOString(), "2026-03-15T12:00:00.000Z");
  assert.notEqual(resolved.generatedAt?.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("LeadCapture writes submitted_at only when the source provided it", () => {
  const withDate = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    lead_id: "lc_1",
    first_name: "Pat",
    last_name: "Lee",
    email: "pat@example.test",
    phone: "5551112222",
    state: "NC",
    submitted_at: "2026-02-02T08:00:00.000Z",
    sa360_source_system: "leadcapture_io_legacy",
  });
  const withIntake = (withDate.routing as { source_intake?: Record<string, unknown> }).source_intake;
  assert.equal(withIntake?.submitted_at, "2026-02-02T08:00:00.000Z");
  assert.equal(withIntake?.generated_at, "2026-02-02T08:00:00.000Z");

  const missing = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    lead_id: "lc_2",
    first_name: "Pat",
    last_name: "Lee",
    email: "pat2@example.test",
    phone: "5551113333",
    state: "NC",
    sa360_source_system: "leadcapture_io_legacy",
  });
  const missingIntake = (missing.routing as { source_intake?: Record<string, unknown> }).source_intake;
  assert.equal(missingIntake?.submitted_at, undefined);
  const resolved = resolveInventoryGeneratedAt({
    normalizedPayloadJson: missing as never,
    enrichmentMetadataJson: { sourceLane: "leadcapture_io" },
    receivedAt: new Date("2026-08-17T00:00:00.000Z"),
  });
  assert.equal(resolved.generatedAt, null);
});

test("Nurse NextGen generatedAt is T1 and receivedAt never substitutes", () => {
  const T1 = "2026-08-18T14:37:03.545Z";
  const payload = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_route_key: "LCIO_NG_NURSE_ANDRU_DURANSO",
    lead_id: "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11",
    submitted_at: T1,
    niche_key: "NURSE",
    first_name: "Casey",
    last_name: "NurseCanary",
    email: "casey.nurse.canary@example.test",
    phone: "5550108111",
    state: "NC",
  });
  const intake = (payload.routing as { source_intake?: Record<string, unknown> }).source_intake;
  assert.equal(intake?.submitted_at, T1);
  assert.equal(intake?.generated_at, T1);
  assert.equal((payload.routing as { niche_key?: string }).niche_key, "NURSE");
  const resolved = resolveInventoryGeneratedAt({
    normalizedPayloadJson: payload as never,
    enrichmentMetadataJson: { sourceLane: "leadcapture_io" },
    receivedAt: new Date("2026-08-18T15:16:48.000Z"),
  });
  assert.equal(resolved.generatedAt?.toISOString(), T1);
  assert.notEqual(resolved.generatedAt?.toISOString(), "2026-08-18T15:16:48.000Z");
});

test("receivedAt never becomes generatedAt fallback for LeadCapture", () => {
  const payload = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_route_key: "LCIO_NG_NURSE_ANDRU_DURANSO",
    lead_id: "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11",
    niche_key: "NURSE",
    first_name: "Casey",
    last_name: "NurseCanary",
    email: "casey.nurse.canary@example.test",
    phone: "5550108111",
    state: "NC",
  });
  const resolved = resolveInventoryGeneratedAt({
    normalizedPayloadJson: payload as never,
    enrichmentMetadataJson: { sourceLane: "leadcapture_io", receivedAt: "2026-08-18T15:16:48.000Z" },
    receivedAt: new Date("2026-08-18T15:16:48.000Z"),
  });
  assert.equal(resolved.generatedAt, null);
});

test("Madison NEXTGEN route-only VET inventories as vet from trusted route, not unspecified", () => {
  const raw = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../fixtures/leadcaptureio/leadcaptureio-webhook-sample-nextgen-madison-nulls.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  assert.equal(raw.niche, undefined);
  assert.equal(raw.niche_key, undefined);
  const payload = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal((payload.routing as { niche_key?: string }).niche_key, "VET");
  assert.equal(payload.state.lead_type, "VET");
  assert.equal(resolveCampaignNicheKey({ normalizedPayloadJson: payload as never }), "vet");
});

test("legacy route-only VET inventories as vet, not unspecified", () => {
  const raw = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../fixtures/leadcaptureio/leadcaptureio-webhook-sample-legacy-route-vet.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const payload = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
  assert.equal((payload.routing as { niche_key?: string }).niche_key, "VET");
  assert.equal(payload.state.lead_type, "VET");
  assert.equal(resolveCampaignNicheKey({ normalizedPayloadJson: payload as never }), "vet");
});
