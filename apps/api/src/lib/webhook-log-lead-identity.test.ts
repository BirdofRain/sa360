import test from "node:test";
import assert from "node:assert/strict";
import {
  UNKNOWN_LEAD,
  deriveLeadIdentityFromLifecyclePayloadJson,
  deriveLeadIdentityFromSourceLeadEvent,
  deriveLeadIdentityFromWebhookBodies,
  mergePreferPrimary,
  resolveWebhookLeadIdentity,
  sourceEventIdFromWebhookRow,
} from "./webhook-log-lead-identity.js";

test("deriveLeadIdentityFromWebhookBodies from request contact", () => {
  const req = {
    contact: {
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      phone_e164: "+15551234567",
    },
  };
  const id = deriveLeadIdentityFromWebhookBodies(req, null);
  assert.equal(id.leadName, "Jane Doe");
  assert.equal(id.leadFirstName, "Jane");
  assert.equal(id.leadLastName, "Doe");
  assert.equal(id.leadEmail, "jane@example.com");
  assert.equal(id.leadPhone, "+15551234567");
});

test("deriveLeadIdentityFromWebhookBodies fills phone from response when missing in request", () => {
  const req = { contact: { first_name: "A", last_name: "B" } };
  const res = { contact: { phone_e164: "+19998887777" } };
  const id = deriveLeadIdentityFromWebhookBodies(req, res);
  assert.equal(id.leadPhone, "+19998887777");
});

test("deriveLeadIdentityFromLifecyclePayloadJson", () => {
  const payload = {
    contact: { first_name: "X", last_name: "Y", email: "x@y.com" },
  };
  const id = deriveLeadIdentityFromLifecyclePayloadJson(payload);
  assert.equal(id.leadName, "X Y");
  assert.equal(id.leadEmail, "x@y.com");
});

test("mergePreferPrimary keeps request names over lifecycle", () => {
  const a = deriveLeadIdentityFromWebhookBodies(
    { contact: { first_name: "Req", last_name: "Only" } },
    null
  );
  const b = deriveLeadIdentityFromLifecyclePayloadJson({
    contact: { first_name: "Evt", last_name: "Other", phone_e164: "+1000" },
  });
  const m = mergePreferPrimary(a, b);
  assert.equal(m.leadFirstName, "Req");
  assert.equal(m.leadLastName, "Only");
  assert.equal(m.leadPhone, "+1000");
});

test("empty bodies yield Unknown lead", () => {
  const id = deriveLeadIdentityFromWebhookBodies(null, {});
  assert.equal(id.leadName, UNKNOWN_LEAD);
});

test("deriveLeadIdentityFromSourceLeadEvent reads normalized contact (Don Bailey)", () => {
  const normalized = {
    contact: {
      first_name: "Don",
      last_name: "Bailey",
      email: "Yeliab1950@yahoo.com",
      phone_e164: "+14692630417",
      state: "Texas",
      lead_uid: "leadcaptureio-leadcapture_io_legacy-4681962",
    },
  };
  const id = deriveLeadIdentityFromSourceLeadEvent(normalized, { name: "{{name}}" });
  assert.equal(id.leadName, "Don Bailey");
  assert.equal(id.leadFirstName, "Don");
  assert.equal(id.leadLastName, "Bailey");
  assert.equal(id.leadEmail, "Yeliab1950@yahoo.com");
  assert.equal(id.leadPhone, "+14692630417");
});

test("deriveLeadIdentityFromSourceLeadEvent falls back to raw payload name", () => {
  const id = deriveLeadIdentityFromSourceLeadEvent({ contact: {} }, { name: "Reece Gilmore" });
  assert.equal(id.leadName, "Reece Gilmore");
  assert.equal(id.leadFirstName, "Reece");
  assert.equal(id.leadLastName, "Gilmore");
});

test("deriveLeadIdentityFromSourceLeadEvent falls back to email then phone", () => {
  const emailOnly = deriveLeadIdentityFromSourceLeadEvent(
    { contact: { email: "lead@example.test" } },
    {}
  );
  assert.equal(emailOnly.leadName, "lead@example.test");
  const phoneOnly = deriveLeadIdentityFromSourceLeadEvent(
    { contact: { phone: "+15550100001" } },
    {}
  );
  assert.equal(phoneOnly.leadName, "+15550100001");
});

test("deriveLeadIdentityFromSourceLeadEvent yields Unknown lead when nothing parseable", () => {
  assert.equal(deriveLeadIdentityFromSourceLeadEvent({ contact: {} }, {}).leadName, UNKNOWN_LEAD);
  assert.equal(deriveLeadIdentityFromSourceLeadEvent(null, null).leadName, UNKNOWN_LEAD);
});

test("source-event identity wins over empty body identity when merged as primary", () => {
  const fromSource = deriveLeadIdentityFromSourceLeadEvent(
    { contact: { first_name: "Don", last_name: "Bailey" } },
    null
  );
  const fromBodies = deriveLeadIdentityFromWebhookBodies(null, {});
  assert.equal(fromBodies.leadName, UNKNOWN_LEAD);
  const merged = mergePreferPrimary(fromSource, fromBodies);
  assert.equal(merged.leadName, "Don Bailey");
});

test("sourceEventIdFromWebhookRow prefers column, falls back to response body sourceEventId", () => {
  assert.equal(
    sourceEventIdFromWebhookRow({ sourceLeadEventId: "sle_col", responseBodyRedacted: {} }),
    "sle_col"
  );
  assert.equal(
    sourceEventIdFromWebhookRow({
      sourceLeadEventId: null,
      responseBodyRedacted: { sourceEventId: "sle_from_response" },
    }),
    "sle_from_response"
  );
  assert.equal(
    sourceEventIdFromWebhookRow({ sourceLeadEventId: null, responseBodyRedacted: null }),
    null
  );
});

test("resolveWebhookLeadIdentity resolves LeadCapture row from source event (Simon squire)", () => {
  // Row mirrors request 2261e5a0… : empty/no-provider body, no lifecycle, source event resolved.
  const identity = resolveWebhookLeadIdentity({
    source: "leadcapture_io",
    requestBodyRedacted: { answers: {} },
    responseBodyRedacted: { sourceEventId: "sle_simon" },
    lifecyclePayloadJson: null,
    sourceEvent: {
      normalizedPayloadJson: { contact: { first_name: "Simon", last_name: "squire" } },
      rawPayloadJson: {},
    },
  });
  assert.equal(identity.leadName, "Simon squire");
});

test("resolveWebhookLeadIdentity preserves GHL lifecycle identity (no source event)", () => {
  const identity = resolveWebhookLeadIdentity({
    source: "ghl_lifecycle",
    requestBodyRedacted: { contact: { first_name: "Grace", last_name: "Hopper" } },
    responseBodyRedacted: null,
    lifecyclePayloadJson: null,
    sourceEvent: null,
  });
  assert.equal(identity.leadName, "Grace Hopper");
});

test("resolveWebhookLeadIdentity yields Unknown lead when nothing resolvable", () => {
  const identity = resolveWebhookLeadIdentity({
    source: "leadcapture_io",
    requestBodyRedacted: { answers: {} },
    responseBodyRedacted: {},
    lifecyclePayloadJson: null,
    sourceEvent: { normalizedPayloadJson: { contact: {} }, rawPayloadJson: {} },
  });
  assert.equal(identity.leadName, UNKNOWN_LEAD);
});

test("deriveLeadIdentityFromWebhookBodies resolves legacy nested aliases", () => {
  const req = {
    provider: "leadcapture_io",
    answers: {
      name: "James LegacyTest",
      phone_number: "+15550103903",
      email: "sa360test+jt-legacy-e2e-20260616-112541@lifeagentlaunch.com",
    },
  };
  const id = deriveLeadIdentityFromWebhookBodies(req, null);
  assert.equal(id.leadName, "James LegacyTest");
  assert.equal(id.leadFirstName, "James");
  assert.equal(id.leadLastName, "LegacyTest");
  assert.equal(id.leadPhone, "+15550103903");
});
