import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeFacebookLeadToLifecyclePayload } from "./facebook-lead-normalizer.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "./leadcapture-io-normalizer.js";
import { resolveInventoryGeneratedAt } from "../lead-inventory/lead-inventory-generated-at.js";

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
