import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLeadCaptureWebhookBody,
  parseUrlEncodedFormBody,
  stripLeadCaptureInternalMetadata,
} from "./leadcapture-webhook-body.js";

const NATIVE_FORM_BODY =
  "ref_id=4652453&name=Reece+Gilmore&phone_number=19416617578&email=reece.gilmore%40example.test&state=Florida+&branch=Army&time_to_call=Evening&military_status=Disabled+Veteran&age=80&desired_coverage=%2425001+-+%2450000";

test("parseUrlEncodedFormBody decodes percent encoding and plus signs", () => {
  const parsed = parseUrlEncodedFormBody(NATIVE_FORM_BODY);
  assert.equal(parsed.ref_id, "4652453");
  assert.equal(parsed.name, "Reece Gilmore");
  assert.equal(parsed.email, "reece.gilmore@example.test");
  assert.equal(parsed.state, "Florida");
  assert.equal(parsed.desired_coverage, "$25001 - $50000");
});

test("parseLeadCaptureWebhookBody accepts application/x-www-form-urlencoded", () => {
  const parsed = parseLeadCaptureWebhookBody(
    NATIVE_FORM_BODY,
    "application/x-www-form-urlencoded"
  );
  assert.equal(parsed?.ref_id, "4652453");
  assert.equal(parsed?.branch, "Army");
});

test("parseLeadCaptureWebhookBody preserves JSON wrapper behavior", () => {
  const parsed = parseLeadCaptureWebhookBody(
    JSON.stringify({ provider: "leadcapture_io", answers: { lead_id: "abc" } }),
    "application/json"
  );
  assert.equal(parsed?.provider, "leadcapture_io");
  const answers = parsed?.answers as Record<string, unknown>;
  assert.equal(answers.lead_id, "abc");
});

test("stripLeadCaptureInternalMetadata removes SA360 intake metadata", () => {
  const stripped = stripLeadCaptureInternalMetadata({
    ref_id: "1",
    _sa360_intake_format: "native_form",
    _sa360_intake_content_type: "application/x-www-form-urlencoded",
  });
  assert.deepEqual(stripped, { ref_id: "1" });
});

test("parseUrlEncodedFormBody rejects excessive field counts", () => {
  const body = Array.from({ length: 501 }, (_, i) => `f${i}=v`).join("&");
  assert.throws(() => parseUrlEncodedFormBody(body), /too_many_fields/);
});
