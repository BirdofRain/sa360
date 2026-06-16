import test from "node:test";
import assert from "node:assert/strict";
import {
  UNKNOWN_LEAD,
  deriveLeadIdentityFromLifecyclePayloadJson,
  deriveLeadIdentityFromWebhookBodies,
  mergePreferPrimary,
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
