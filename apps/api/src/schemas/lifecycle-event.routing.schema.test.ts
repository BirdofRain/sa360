import test from "node:test";
import assert from "node:assert/strict";
import { lifecycleEventSchema } from "./lifecycle-event.schema.js";

const minimalBase = {
  schema_version: "1",
  client_account_id: "ca_1",
  contact: {
    lead_uid: "lead_1",
    contact_id_ghl: "ct_1",
    phone_e164: "+15551234567",
  },
  attribution: {},
  state: {},
  event: {
    event_uuid: "ev_1",
    event_name_internal: "lead_created",
    event_name_meta: "Lead",
  },
};

test("lifecycle accepts routing.calendar_id and routing.calendar_link", () => {
  const parsed = lifecycleEventSchema.safeParse({
    ...minimalBase,
    routing: {
      niche_key: "vet",
      calendar_id: "cal_ghl_1",
      calendar_link: "https://example.com/cal",
    },
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.routing?.calendar_id, "cal_ghl_1");
    assert.equal(parsed.data.routing?.calendar_link, "https://example.com/cal");
  }
});

test("lifecycle accepts sa360_calendar_id aliases", () => {
  const parsed = lifecycleEventSchema.safeParse({
    ...minimalBase,
    routing: {
      sa360_calendar_id: "cal_s1",
      sa360_calendar_link: "https://sa360.example/book",
    },
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.routing?.sa360_calendar_id, "cal_s1");
  }
});
