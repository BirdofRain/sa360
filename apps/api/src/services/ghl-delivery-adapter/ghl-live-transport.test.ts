import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomFieldsForPutFromMap,
  formatCustomFieldStampFailureDetail,
  isPlausibleGhlCustomFieldId,
  summarizeCustomFieldsPutPayload,
} from "./ghl-live-transport.js";
import { resolveSa360CustomFieldIdMap } from "../sa360-custom-field-mapping.service.js";

test("buildCustomFieldsForPutFromMap emits GHL array with id and field_value strings", () => {
  const built = buildCustomFieldsForPutFromMap(
    {
      sa360_lead_uid: "abc123XYZ78901",
      sa360_routing_status: "ghl_field_id",
    },
    {
      sa360_lead_uid: "lead_1",
      sa360_routing_status: "ROUTED",
    }
  );
  assert.equal(built.apiPayload.length, 1);
  assert.deepEqual(built.apiPayload[0], {
    id: "abc123XYZ78901",
    field_value: "lead_1",
  });
  assert.equal(built.diagnostics[0]?.logicalKey, "sa360_lead_uid");
  assert.equal(built.diagnostics[0]?.valueType, "string");
  const summary = summarizeCustomFieldsPutPayload(built);
  assert.equal(summary.shape, "array");
  assert.equal(summary.count, 1);
  assert.equal(summary.items[0]?.logicalKey, "sa360_lead_uid");
});

test("resolveSa360CustomFieldIdMap prefers destination_config without env merge when dest map exists", () => {
  const prev = process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
  process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON = JSON.stringify({
    sa360_lead_uid: "env_only_id_12345678",
  });
  const resolved = resolveSa360CustomFieldIdMap({
    destinationMapJson: { sa360_lead_uid: "dest_id_12345678" },
    useEnvFallback: false,
  });
  assert.equal(resolved.source, "destination_config");
  assert.equal(resolved.idMap.sa360_lead_uid, "dest_id_12345678");
  if (prev !== undefined) process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON = prev;
  else delete process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
});

test("isPlausibleGhlCustomFieldId rejects placeholder tokens", () => {
  assert.equal(isPlausibleGhlCustomFieldId("abc123XYZ78901"), true);
  assert.equal(isPlausibleGhlCustomFieldId("GHL_FIELD_ID"), false);
  assert.equal(isPlausibleGhlCustomFieldId("short"), false);
});

test("formatCustomFieldStampFailureDetail includes logical keys and mapping source", () => {
  const built = buildCustomFieldsForPutFromMap(
    { sa360_lead_uid: "abc123XYZ78901" },
    { sa360_lead_uid: "lead_1" }
  );
  const detail = formatCustomFieldStampFailureDetail({
    ghlError: "Unprocessable Entity",
    shapeSummary: summarizeCustomFieldsPutPayload(built),
    mappingSource: "destination_config",
  });
  assert.ok(detail.includes("Unprocessable Entity"));
  assert.ok(detail.includes("sa360_lead_uid"));
  assert.ok(detail.includes("destination_config"));
});
