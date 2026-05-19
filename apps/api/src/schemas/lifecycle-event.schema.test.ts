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

test("lifecycle schema accepts sold policy fields from MASTER VET payloads", () => {
  const enriched = parseAndEnrich({
    schema_version: "1.0",
    client_account_id: "client_demo",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_sold_mv_001",
      event_name_internal: "sold",
      event_name_meta: "Purchase",
      send_to_meta: false,
    },
    policy: {
      policy_status: "APP_STARTED",
      carrier: "Demo Carrier",
      product_type: "Term Life",
      monthly_premium: "125.50",
      annual_premium: 1506,
      policy_effective_date: "2026-06-01",
    },
  });
  assert.equal(enriched.state.lifecycle_stage, "SOLD");
  assert.ok(enriched.policy);
  assert.equal(enriched.policy?.product_type, "Term Life");
  assert.equal(enriched.policy?.monthly_premium, "125.50");
  assert.equal(enriched.policy?.annual_premium, 1506);
});

test("lifecycle schema accepts appointment_set with SA360 appointment fields", () => {
  const enriched = parseAndEnrich({
    schema_version: "1.0",
    client_account_id: "client_demo",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_appt_mv_001",
      event_name_internal: "appointment_set",
      event_name_meta: "Schedule",
      send_to_meta: false,
    },
    appointment: {
      appointment_status: "SET",
      booking_source: "ghl_workflow",
      calendar_link: "https://calendar.example/book",
      calendar_id: "cal_123",
      appointment_start_time: "2026-05-21T15:00:00.000Z",
    },
  });
  assert.equal(enriched.state.lifecycle_stage, "APPOINTMENT_SET");
  assert.equal(enriched.state.appointment_status, "SET");
  assert.equal(enriched.appointment?.calendar_link, "https://calendar.example/book");
});

test("lifecycle schema accepts appointment_showed payload", () => {
  const enriched = parseAndEnrich({
    schema_version: "1.0",
    client_account_id: "client_demo",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_show_001",
      event_name_internal: "appointment_showed",
      event_name_meta: "Showed",
      send_to_meta: false,
    },
    appointment: {
      appointment_status: "SHOWED",
      appointment_showed_at: "2026-05-21T16:00:00.000Z",
      show_outcome: "qualified",
      calendar_id: "cal_123",
      calendar_name: "Sales Calendar",
      booking_source: "ai",
    },
  });
  assert.equal(enriched.state.lifecycle_stage, "APPOINTMENT_SHOWED");
  assert.equal(enriched.state.appointment_status, "SHOWED");
  assert.equal(enriched.state.agent_disposition, "SHOWED");
});

test("lifecycle schema accepts appointment_no_show payload", () => {
  const enriched = parseAndEnrich({
    schema_version: "1.0",
    client_account_id: "client_demo",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_noshow_001",
      event_name_internal: "appointment_no_show",
      event_name_meta: "No Show",
      send_to_meta: false,
    },
    appointment: {
      appointment_status: "NO_SHOW",
      appointment_no_show_at: "2026-05-21T16:05:00.000Z",
      no_show_reason: "no_answer",
      reschedule_link: "https://calendar.example/reschedule",
    },
  });
  assert.equal(enriched.state.lifecycle_stage, "FOLLOW_UP");
  assert.equal(enriched.state.appointment_status, "NO_SHOW");
});

test("lifecycle schema rejects unknown policy keys", () => {
  const parsed = lifecycleEventSchema.safeParse({
    schema_version: "1.0",
    client_account_id: "client_demo",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_p1",
      event_name_internal: "sold",
      event_name_meta: "Purchase",
    },
    policy: {
      carrier: "Acme",
      not_a_policy_field: "nope",
    },
  });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.ok(parsed.error.flatten().fieldErrors.policy?.length);
});

test("lifecycle schema rejects unknown appointment keys", () => {
  const parsed = lifecycleEventSchema.safeParse({
    schema_version: "1.0",
    client_account_id: "client_demo",
    contact: baseContact,
    state: {},
    event: {
      event_uuid: "evt_a1",
      event_name_internal: "appointment_set",
      event_name_meta: "Schedule",
    },
    appointment: {
      appointment_status: "SET",
      mystery_field: "nope",
    },
  });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.ok(parsed.error.flatten().fieldErrors.appointment?.length);
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
