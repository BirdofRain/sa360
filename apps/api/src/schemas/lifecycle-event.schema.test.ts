import test from "node:test";
import assert from "node:assert/strict";
import { enrichLifecyclePayloadForIngest } from "../lib/lifecycle-event-enrich.js";
import { lifecycleEventSchema } from "./lifecycle-event.schema.js";

const baseContact = {
  lead_uid: "lead_test_001",
  contact_id_ghl: "ghl_contact_001",
  first_name: "Test",
  last_name: "Lead",
  phone_e164: "+15551234001",
  email: "test@example.com",
};

function parseAndEnrich(body: unknown) {
  const parsed = lifecycleEventSchema.safeParse(body);
  assert.equal(parsed.success, true, JSON.stringify(parsed.success ? "" : parsed.error.flatten()));
  if (!parsed.success) throw new Error("parse failed");
  return enrichLifecyclePayloadForIngest({
    ...parsed.data,
    attribution: parsed.data.attribution ?? {},
  });
}

test("lifecycle schema accepts appointment_set with appointment block", () => {
  const enriched = parseAndEnrich({
    schema_version: "1.0",
    client_account_id: "client_demo",
    subaccount_id_ghl: "loc_demo_ghl_001",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_appt_set_001",
      event_name_internal: "appointment_set",
      event_name_meta: "Schedule",
      event_time_unix: 1710000000,
      send_to_meta: false,
    },
    ownership: { assigned_agent_name: "Jordan Rivera" },
    appointment: {
      scheduled_at: "2026-05-20T15:00:00.000Z",
      status: "Scheduled",
      source: "ai",
    },
    ai: { booked: true, channel: "voice" },
  });
  assert.equal(enriched.event.event_name_internal, "appointment_set");
  assert.equal(enriched.state.appointment_status, "Scheduled");
  assert.equal(enriched.state.lifecycle_stage, "APPOINTMENT_SET");
  assert.ok(enriched.state.ai_status?.includes("booked"));
});

test("lifecycle schema accepts contact_replied without attribution", () => {
  const enriched = parseAndEnrich({
    schema_version: "1.0",
    client_account_id: "client_demo",
    subaccount_id_ghl: "loc_demo_ghl_001",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_reply_001",
      event_name_internal: "contact_replied",
      event_name_meta: "Contact",
      send_to_meta: false,
    },
  });
  assert.equal(enriched.state.lifecycle_stage, "AI_ENGAGED");
  assert.deepEqual(enriched.attribution, {});
});

test("lifecycle schema accepts call_attempt_logged with call block", () => {
  const enriched = parseAndEnrich({
    schema_version: "1.0",
    client_account_id: "client_demo",
    subaccount_id_ghl: "loc_demo_ghl_001",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_call_001",
      event_name_internal: "call_attempt_logged",
      event_name_meta: "Contact",
      send_to_meta: false,
    },
    call: {
      direction: "outbound",
      outcome: "attempted",
      duration_seconds: 0,
    },
  });
  assert.equal(enriched.state.lifecycle_stage, "ATTEMPTING_CONTACT");
  assert.equal(enriched.state.agent_disposition, "attempted");
});

test("lifecycle schema accepts disposition_logged", () => {
  const enriched = parseAndEnrich({
    schema_version: "1.0",
    client_account_id: "client_demo",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_disp_001",
      event_name_internal: "disposition_logged",
      event_name_meta: "Contact",
      send_to_meta: false,
    },
    disposition: {
      code: "interested",
      notes: "Wants term quote",
      logged_by: "agent_1",
    },
  });
  assert.equal(enriched.state.agent_disposition, "interested");
});

test("lifecycle schema accepts sold with policy block", () => {
  const enriched = parseAndEnrich({
    schema_version: "1.0",
    client_account_id: "client_demo",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_sold_001",
      event_name_internal: "sold",
      event_name_meta: "Purchase",
      value_score: 5000,
      send_to_meta: false,
    },
    policy: {
      policy_status: "Issued",
      premium_estimate: 4200,
      carrier: "Demo Carrier",
    },
  });
  assert.equal(enriched.state.lifecycle_stage, "SOLD");
  assert.equal(enriched.state.agent_disposition, "sold");
  assert.equal(enriched.state.policy_status, "Issued");
});

test("lifecycle schema accepts attribution fbc and fbp", () => {
  const enriched = parseAndEnrich({
    schema_version: "1.0",
    client_account_id: "client_demo",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_lead_001",
      event_name_internal: "lead_created",
      event_name_meta: "Lead",
      send_to_meta: false,
    },
    attribution: {
      source_platform: "facebook",
      fbclid: "fb.1.123",
      fbc: "fb.1.1700000000.AbCdEf",
      fbp: "fb.1.1700000000.987654321",
    },
  });
  assert.ok(enriched.attribution);
  assert.equal(enriched.attribution.fbc, "fb.1.1700000000.AbCdEf");
  assert.equal(enriched.attribution.fbp, "fb.1.1700000000.987654321");
});

test("lifecycle schema rejects unknown attribution keys", () => {
  const parsed = lifecycleEventSchema.safeParse({
    schema_version: "1.0",
    client_account_id: "client_demo",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_x",
      event_name_internal: "lead_created",
      event_name_meta: "Lead",
    },
    attribution: {
      fbc: "fb.1.ok",
      not_a_real_attribution_field: "nope",
    },
  });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const fieldErrors = parsed.error.flatten().fieldErrors;
  assert.ok(fieldErrors.attribution?.length);
});

test("lifecycle schema rejects unknown event_name_internal", () => {
  const parsed = lifecycleEventSchema.safeParse({
    schema_version: "1.0",
    client_account_id: "client_demo",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_x",
      event_name_internal: "not_a_real_event",
      event_name_meta: "Contact",
    },
  });
  assert.equal(parsed.success, false);
});
