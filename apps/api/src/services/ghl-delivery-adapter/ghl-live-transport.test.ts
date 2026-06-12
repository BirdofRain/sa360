import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomFieldsForPutFromMap,
  buildSa360LeadUidCustomFieldShapeProbes,
  buildSingleLogicalCustomFieldPutPayload,
  formatCustomFieldStampFailureDetail,
  formatGhlPutContactFailureDetail,
  isPlausibleGhlCustomFieldId,
  parseGhlApiErrorSummary,
  redactGhlPayload,
  summarizeCustomFieldsPutPayload,
} from "./ghl-live-transport.js";
import { resolveSa360CustomFieldIdMap } from "../sa360-custom-field-mapping.service.js";

const FIELD_ID = "abc123XYZ78901";
const FIELD_KEY = "contact.sa360_lead_uid";

test("buildCustomFieldsForPutFromMap emits GHL array with id, key, and field_value strings", () => {
  const built = buildCustomFieldsForPutFromMap(
    {
      sa360_lead_uid: FIELD_ID,
      sa360_routing_status: "ghlFieldId12345678",
    },
    {
      sa360_lead_uid: "lead_1",
      sa360_routing_status: "ROUTED",
    }
  );
  assert.equal(built.apiPayload.length, 2);
  assert.deepEqual(built.apiPayload[0], {
    id: FIELD_ID,
    key: "contact.sa360_lead_uid",
    field_value: "lead_1",
  });
  assert.deepEqual(built.apiPayload[1], {
    id: "ghlFieldId12345678",
    key: "contact.sa360_routing_status",
    field_value: "ROUTED",
  });
  assert.deepEqual(built.diagnostics[0]?.itemKeys, ["field_value", "id", "key"]);
  assert.equal(built.diagnostics[0]?.valueProperty, "field_value");
  assert.equal(built.diagnostics[0]?.logicalKey, "sa360_lead_uid");
  const summary = summarizeCustomFieldsPutPayload(built);
  assert.equal(summary.shape, "array");
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.firstItemKeys, ["field_value", "id", "key"]);
  assert.equal(summary.valuePropertyUsed, "field_value");
  assert.equal(summary.items[0]?.logicalKey, "sa360_lead_uid");
  assert.equal(summary.items[0]?.ghlFieldKey, "contact.sa360_lead_uid");
});

test("buildCustomFieldsForPutFromMap uses destination key map when provided", () => {
  const built = buildCustomFieldsForPutFromMap(
    { sa360_lead_uid: FIELD_ID },
    { sa360_lead_uid: "lead_1" },
    { keyMap: { sa360_lead_uid: "contact.custom_lead_uid_key" } }
  );
  assert.equal(built.apiPayload[0]?.key, "contact.custom_lead_uid_key");
});

test("buildSa360LeadUidCustomFieldShapeProbes compares documented GHL shapes without live calls", () => {
  const probes = buildSa360LeadUidCustomFieldShapeProbes({
    fieldId: FIELD_ID,
    fieldKey: FIELD_KEY,
    value: "lead_probe_1",
  });
  assert.equal(probes.length, 4);
  assert.deepEqual(probes[0]?.item, { id: FIELD_ID, value: "lead_probe_1" });
  assert.deepEqual(probes[1]?.item, { id: FIELD_ID, field_value: "lead_probe_1" });
  assert.deepEqual(probes[2]?.item, { key: FIELD_KEY, field_value: "lead_probe_1" });
  assert.deepEqual(probes[3]?.item, {
    id: FIELD_ID,
    key: FIELD_KEY,
    field_value: "lead_probe_1",
  });
  const production = buildSingleLogicalCustomFieldPutPayload(
    "sa360_lead_uid",
    FIELD_ID,
    "lead_probe_1"
  );
  assert.deepEqual(production, probes[3]?.item);
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

test("isPlausibleGhlCustomFieldId rejects placeholder tokens and field keys", () => {
  assert.equal(isPlausibleGhlCustomFieldId("abc123XYZ78901"), true);
  assert.equal(isPlausibleGhlCustomFieldId("GHL_FIELD_ID"), false);
  assert.equal(isPlausibleGhlCustomFieldId("short"), false);
  assert.equal(isPlausibleGhlCustomFieldId("contact.sa360_lead_uid"), false);
});

test("formatCustomFieldStampFailureDetail includes item keys, mapping source, and sanitized response", () => {
  const built = buildCustomFieldsForPutFromMap(
    { sa360_lead_uid: FIELD_ID },
    { sa360_lead_uid: "lead_1" }
  );
  const detail = formatCustomFieldStampFailureDetail({
    ghlError: "Unprocessable Entity",
    shapeSummary: summarizeCustomFieldsPutPayload(built),
    mappingSource: "destination_config",
    ghlResponseSanitized: redactGhlPayload({ message: "invalid custom field id" }),
    failedLogicalKey: "sa360_lead_uid",
  });
  assert.ok(detail.includes("Unprocessable Entity"));
  assert.ok(detail.includes("sa360_lead_uid"));
  assert.ok(detail.includes("destination_config"));
  assert.ok(detail.includes("first item keys"));
  assert.ok(detail.includes("field_value"));
  assert.ok(detail.includes("invalid custom field id"));
  assert.ok(!detail.includes("Bearer"));
  assert.ok(!detail.includes("access_token"));
});

test("formatCustomFieldStampFailureDetail includes endpoint and body keys when provided", () => {
  const built = buildCustomFieldsForPutFromMap(
    { sa360_lead_uid: FIELD_ID },
    { sa360_lead_uid: "lead_1" }
  );
  const detail = formatCustomFieldStampFailureDetail({
    ghlError: "property locationId should not exist",
    shapeSummary: summarizeCustomFieldsPutPayload(built),
    mappingSource: "destination_config",
    endpoint: "PUT /contacts/{contactId}",
    bodyKeys: ["customFields"],
  });
  assert.ok(detail.includes("property locationId should not exist"));
  assert.ok(detail.includes("endpoint: PUT /contacts/{contactId}"));
  assert.ok(detail.includes("body keys: customFields"));
  assert.ok(!detail.includes("Bearer"));
});

test("formatGhlPutContactFailureDetail surfaces 422 validation with endpoint and body keys", () => {
  const detail = formatGhlPutContactFailureDetail({
    ghlError: parseGhlApiErrorSummary("", {
      message: ["property locationId should not exist"],
      error: "Unprocessable Entity",
      statusCode: 422,
    }),
    endpoint: "PUT /contacts/{contactId}",
    bodyKeys: ["assignedTo"],
    ghlResponseSanitized: redactGhlPayload({
      message: ["property locationId should not exist"],
      statusCode: 422,
    }),
  });
  assert.ok(detail.includes("property locationId should not exist"));
  assert.ok(detail.includes("endpoint: PUT /contacts/{contactId}"));
  assert.ok(detail.includes("body keys: assignedTo"));
  assert.ok(!detail.includes("Bearer"));
});

test("parseGhlApiErrorSummary reads GHL message array", () => {
  assert.equal(
    parseGhlApiErrorSummary("", {
      message: ["property locationId should not exist"],
      error: "Unprocessable Entity",
      statusCode: 422,
    }),
    "property locationId should not exist"
  );
});

test("custom field diagnostics contain no auth tokens", () => {
  const built = buildCustomFieldsForPutFromMap(
    { sa360_lead_uid: FIELD_ID },
    { sa360_lead_uid: "lead_1" }
  );
  const summary = summarizeCustomFieldsPutPayload(built);
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes("Bearer"));
  assert.ok(!serialized.match(/access_token|refresh_token|private.?integration/i));
});
