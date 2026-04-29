import assert from "node:assert/strict";
import test from "node:test";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import {
  pickRawContactPhoneFromContact,
  resolveLifecycleContactPhoneDetails,
} from "./lifecycle-contact-phone.js";

test("pickRawContactPhoneFromContact prefers phone_e164", () => {
  const contact: LifecycleEventSchema["contact"] = {
    lead_uid: "L1",
    phone_e164: "+15551230123",
    phone: "(555) 999-0000",
  };
  const r = pickRawContactPhoneFromContact(contact);
  assert.equal(r.source, "phone_e164");
  assert.equal(r.raw, "+15551230123");
});

test("pickRawContactPhoneFromContact falls back to phone", () => {
  const contact: LifecycleEventSchema["contact"] = {
    lead_uid: "L1",
    phone: "(555) 999-0000",
  };
  const r = pickRawContactPhoneFromContact(contact);
  assert.equal(r.source, "phone");
});

test("pickRawContactPhoneFromContact falls back to phone_digits", () => {
  const contact: LifecycleEventSchema["contact"] = {
    lead_uid: "L1",
    phone_digits: "5551234567",
  };
  const r = pickRawContactPhoneFromContact(contact);
  assert.equal(r.source, "phone_digits");
});

test("resolveLifecycleContactPhoneDetails normalizes US digits", () => {
  const payload = {
    schema_version: "1",
    client_account_id: "c1",
    contact: {
      lead_uid: "L1",
      phone_digits: "5551234567",
    },
    attribution: {},
    state: {},
    event: {
      event_uuid: "e1",
      event_name_internal: "contact_updated",
      event_name_meta: "Contact",
      event_time_unix: 1,
    },
  } as LifecycleEventSchema;

  const d = resolveLifecycleContactPhoneDetails(payload);
  assert.equal(d.raw_source, "phone_digits");
  assert.equal(d.normalized_e164, "+15551234567");
  assert.equal(d.phone_skip_reason, null);
});

test("resolveLifecycleContactPhoneDetails normalizes formatted US phone_e164", () => {
  const payload = {
    schema_version: "1",
    client_account_id: "c1",
    contact: {
      lead_uid: "L1",
      phone_e164: "(731) 335-5212",
    },
    attribution: {},
    state: {},
    event: {
      event_uuid: "e1",
      event_name_internal: "contact_updated",
      event_name_meta: "Contact",
      event_time_unix: 1,
    },
  } as LifecycleEventSchema;

  const d = resolveLifecycleContactPhoneDetails(payload);
  assert.equal(d.raw_source, "phone_e164");
  assert.equal(d.normalized_e164, "+17313355212");
});

test("resolveLifecycleContactPhoneDetails normalizes 10 and 11 digit US inputs", () => {
  const base = {
    schema_version: "1",
    client_account_id: "c1",
    attribution: {},
    state: {},
    event: {
      event_uuid: "e1",
      event_name_internal: "contact_updated",
      event_name_meta: "Contact",
      event_time_unix: 1,
    },
  };

  const d10 = resolveLifecycleContactPhoneDetails({
    ...base,
    contact: { lead_uid: "L1", phone_e164: "7313355212" },
  } as LifecycleEventSchema);
  assert.equal(d10.normalized_e164, "+17313355212");

  const d11 = resolveLifecycleContactPhoneDetails({
    ...base,
    contact: { lead_uid: "L1", phone_e164: "17313355212" },
  } as LifecycleEventSchema);
  assert.equal(d11.normalized_e164, "+17313355212");

  const dPlus = resolveLifecycleContactPhoneDetails({
    ...base,
    contact: { lead_uid: "L1", phone_e164: "+17313355212" },
  } as LifecycleEventSchema);
  assert.equal(dPlus.normalized_e164, "+17313355212");
});

test("resolveLifecycleContactPhoneDetails yields null when phone cannot become valid E.164", () => {
  const payload = {
    schema_version: "1",
    client_account_id: "c1",
    contact: {
      lead_uid: "L1",
      phone_e164: "call-me",
    },
    attribution: {},
    state: {},
    event: {
      event_uuid: "e1",
      event_name_internal: "contact_updated",
      event_name_meta: "Contact",
      event_time_unix: 1,
    },
  } as LifecycleEventSchema;

  const d = resolveLifecycleContactPhoneDetails(payload);
  assert.equal(d.normalized_e164, null);
  assert.equal(d.phone_skip_reason, "not_valid_e164_after_normalize");
});
