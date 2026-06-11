import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomFieldsForPutFromMap,
  isPlausibleGhlCustomFieldId,
  summarizeCustomFieldsPutPayload,
} from "./ghl-live-transport.js";

test("buildCustomFieldsForPutFromMap emits array items with id key and field_value", () => {
  const items = buildCustomFieldsForPutFromMap(
    {
      sa360_lead_uid: "abc123XYZ78901",
      sa360_routing_status: "ghl_field_id",
    },
    {
      sa360_lead_uid: "lead_1",
      sa360_routing_status: "ROUTED",
    }
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.key, "sa360_lead_uid");
  assert.equal(items[0]?.id, "abc123XYZ78901");
  assert.equal(items[0]?.field_value, "lead_1");
  const summary = summarizeCustomFieldsPutPayload(items);
  assert.equal(summary.shape, "array");
  assert.equal(summary.count, 1);
  assert.equal(summary.items[0]?.key, "sa360_lead_uid");
});

test("isPlausibleGhlCustomFieldId rejects placeholder tokens", () => {
  assert.equal(isPlausibleGhlCustomFieldId("abc123XYZ78901"), true);
  assert.equal(isPlausibleGhlCustomFieldId("GHL_FIELD_ID"), false);
  assert.equal(isPlausibleGhlCustomFieldId("short"), false);
});
