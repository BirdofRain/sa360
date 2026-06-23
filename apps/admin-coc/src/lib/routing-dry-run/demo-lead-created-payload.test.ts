import test from "node:test";
import assert from "node:assert/strict";
import { parseRoutingDryRunTestJson } from "./routing-dry-run-test.util.ts";
import {
  buildDemoDylanLeadCreatedPayload,
  demoDylanLeadCreatedPayloadJson,
} from "./demo-lead-created-payload.ts";

test("demo Dylan payload parses without hardcoded master client", () => {
  const payload = buildDemoDylanLeadCreatedPayload(1_700_000_000_000);
  const parsed = parseRoutingDryRunTestJson(JSON.stringify(payload));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.payload.client_account_id, undefined);
  const event = parsed.payload.event as Record<string, unknown>;
  assert.match(String(event.event_uuid), /^demo_dylan_evt_/);
  const attr = parsed.payload.attribution as Record<string, unknown>;
  assert.equal(attr.campaign_id, "120241930690720364");
});

test("demo Dylan payload accepts optional master client injection", () => {
  const payload = buildDemoDylanLeadCreatedPayload(1_700_000_000_000, "master_demo");
  assert.equal(payload.client_account_id, "master_demo");
});

test("demoDylanLeadCreatedPayloadJson returns valid JSON string", () => {
  const raw = demoDylanLeadCreatedPayloadJson();
  assert.doesNotThrow(() => JSON.parse(raw));
});
