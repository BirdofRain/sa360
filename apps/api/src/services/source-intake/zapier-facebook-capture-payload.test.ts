import assert from "node:assert/strict";
import { test } from "node:test";

import { parseZapierFacebookCapturePayload } from "./zapier-facebook-capture-payload.js";

const SUBMITTED = "2025-11-04T15:04:00.000Z";

test("parser keeps submitted_at and omits missing campaign metadata", () => {
  const parsed = parseZapierFacebookCapturePayload({
    leadgen_id: "900000000000001",
    page_id: "900000000000101",
    form_id: "900000000000201",
    first_name: "Sam",
    last_name: "Rivera",
    email: "sam.rivera@example.test",
    phone: "+15555550123",
    submitted_at: SUBMITTED,
    form_name: "Synthetic Health Form",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.fields.leadgenId, "900000000000001");
  assert.equal(parsed.fields.submittedAt, SUBMITTED);
  assert.equal(parsed.fields.campaignId, null);
  assert.equal(parsed.fields.campaignName, null);
  assert.equal(parsed.fields.adId, null);
  assert.equal(parsed.fields.adName, null);
  assert.equal(parsed.fields.adsetId, null);
  assert.equal(parsed.fields.formIdentityStatus, "present");
  assert.equal("utm_campaign" in parsed.fields, false);
});

test("parser rejects unsafe numeric Facebook IDs and invalid leadgen ids", () => {
  const unsafe = parseZapierFacebookCapturePayload({
    leadgen_id: Number.MAX_SAFE_INTEGER + 2,
    page_id: "900000000000101",
    form_id: "900000000000201",
  });
  assert.equal(unsafe.ok, false);
  if (unsafe.ok) return;
  assert.equal(unsafe.error, "unsafe_facebook_id");

  const missing = parseZapierFacebookCapturePayload({ page_id: "900000000000101" });
  assert.equal(missing.ok, false);
});

test("invalid form identity does not fail the leadgen parse", () => {
  const parsed = parseZapierFacebookCapturePayload({
    leadgen_id: "900000000000001",
    page_id: "not-a-page",
    form_id: "900000000000201",
    created_time: "2025-11-04T15:04:00Z",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.fields.formIdentityStatus, "invalid");
  assert.equal(parsed.fields.pageId, null);
  assert.equal(parsed.fields.submittedAt, "2025-11-04T15:04:00.000Z");
});
