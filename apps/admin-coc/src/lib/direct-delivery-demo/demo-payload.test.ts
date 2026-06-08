import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDirectDemoLeadCreatedPayload,
  directDemoLeadCreatedPayloadJson,
} from "./demo-payload.ts";
import { DIRECT_DEMO_LIVE_CONFIRMATION_TEXT } from "./types.ts";

test("demo payload uses lal_master_vet and lead_created", () => {
  const payload = buildDirectDemoLeadCreatedPayload(12345);
  assert.equal(payload.client_account_id, "lal_master_vet");
  const event = payload.event as { event_name_internal: string; event_uuid: string };
  assert.equal(event.event_name_internal, "lead_created");
  assert.ok(event.event_uuid.includes("demo_sa360_evt"));
  const contact = payload.contact as { email: string; first_name: string };
  assert.equal(contact.first_name, "Test");
  assert.ok(contact.email.includes("@example.test"));
  assert.ok(!contact.email.includes("paul"));
});

test("directDemoLeadCreatedPayloadJson is valid JSON", () => {
  const raw = directDemoLeadCreatedPayloadJson();
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  assert.ok(parsed.attribution);
});

test("live confirmation constant matches API contract", () => {
  assert.equal(DIRECT_DEMO_LIVE_CONFIRMATION_TEXT, "DELIVER ONE LEAD");
});
