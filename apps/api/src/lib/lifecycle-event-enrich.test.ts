import test from "node:test";
import assert from "node:assert/strict";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { enrichLifecyclePayloadForIngest } from "./lifecycle-event-enrich.js";

const minimal: LifecycleEventSchema = {
  schema_version: "1.0",
  client_account_id: "c1",
  contact: {
    lead_uid: "l1",
    contact_id_ghl: "g1",
    phone_e164: "+15550001111",
  },
  state: {},
  event: {
    event_uuid: "e1",
    event_name_internal: "lead_created",
    event_name_meta: "Lead",
  },
};

test("enrich preserves lead_created lifecycle stage default", () => {
  const out = enrichLifecyclePayloadForIngest(minimal);
  assert.equal(out.state.lifecycle_stage, "NEW");
});

test("enrich maps dnc event to DNC stage", () => {
  const out = enrichLifecyclePayloadForIngest({
    ...minimal,
    event: { ...minimal.event, event_uuid: "e2", event_name_internal: "dnc" },
  });
  assert.equal(out.state.lifecycle_stage, "DNC");
});

test("enrich appointment_set defaults SET without overwriting explicit state", () => {
  const out = enrichLifecyclePayloadForIngest({
    ...minimal,
    state: { appointment_status: "CONFIRMED" },
    event: { ...minimal.event, event_uuid: "e3", event_name_internal: "appointment_set" },
  });
  assert.equal(out.state.lifecycle_stage, "APPOINTMENT_SET");
  assert.equal(out.state.appointment_status, "CONFIRMED");
});

test("enrich appointment_no_show prefers FOLLOW_UP stage", () => {
  const out = enrichLifecyclePayloadForIngest({
    ...minimal,
    event: { ...minimal.event, event_uuid: "e4", event_name_internal: "appointment_no_show" },
    appointment: { appointment_status: "NO_SHOW" },
  });
  assert.equal(out.state.lifecycle_stage, "FOLLOW_UP");
  assert.equal(out.state.appointment_status, "NO_SHOW");
});

test("enrich sold uses policy_status from policy block over APP_STARTED default", () => {
  const out = enrichLifecyclePayloadForIngest({
    ...minimal,
    event: { ...minimal.event, event_uuid: "e5", event_name_internal: "sold" },
    policy: { policy_status: "Issued" },
  });
  assert.equal(out.state.policy_status, "Issued");
});
