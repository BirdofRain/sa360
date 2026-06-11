import test from "node:test";
import assert from "node:assert/strict";
import {
  assessSa360FieldMapping,
  assessCustomFieldStampReadiness,
  auditSa360FieldMappingAgainstDiscovery,
  buildSa360CustomFieldIdMapFromDiscovery,
  buildSa360CustomFieldKeyMapFromDiscovery,
  mergeSa360CustomFieldIdMaps,
  parseSa360CustomFieldIdMapJson,
  resolveSa360CustomFieldIdMap,
  resolveSa360CustomFieldKeyMap,
} from "./sa360-custom-field-mapping.service.js";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery/ghl-config-discovery.types.js";

test("buildSa360CustomFieldIdMapFromDiscovery maps discovered SA360 keys to GHL IDs", () => {
  const map = buildSa360CustomFieldIdMapFromDiscovery([
    { id: "ghl_uid", name: "Lead UID", key: "lead_uid", fieldKey: "contact.sa360_lead_uid", dataType: "TEXT" },
    { id: "ghl_status", name: "Routing", key: null, fieldKey: "contact.sa360_routing_status", dataType: "TEXT" },
  ]);
  assert.equal(map.sa360_lead_uid, "ghl_uid");
  assert.equal(map.sa360_routing_status, "ghl_status");
});

test("resolveSa360CustomFieldIdMap prefers destination config over env fallback", () => {
  const prev = process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
  process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON = JSON.stringify({
    sa360_lead_uid: "env_uid",
    sa360_routing_status: "env_status",
  });

  const { idMap, source } = resolveSa360CustomFieldIdMap({
    destinationMapJson: { sa360_lead_uid: "dest_uid" },
    useEnvFallback: true,
  });
  assert.equal(source, "merged");
  assert.equal(idMap.sa360_lead_uid, "dest_uid");
  assert.equal(idMap.sa360_routing_status, "env_status");

  if (prev !== undefined) process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON = prev;
  else delete process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
});

test("resolveSa360CustomFieldIdMap uses env fallback when destination empty", () => {
  const prev = process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
  process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON = JSON.stringify({ sa360_lead_uid: "env_only" });

  const { idMap, source } = resolveSa360CustomFieldIdMap({
    destinationMapJson: {},
    useEnvFallback: true,
  });
  assert.equal(source, "env_fallback");
  assert.equal(idMap.sa360_lead_uid, "env_only");

  if (prev !== undefined) process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON = prev;
  else delete process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
});

test("assessSa360FieldMapping reports core required missing keys", () => {
  const assessment = assessSa360FieldMapping(
    { sa360_lead_uid: "id1", sa360_client_account_id: "id2" },
    "destination_config",
    true
  );
  assert.equal(assessment.coreRequiredMapped.length, 2);
  assert.ok(assessment.coreRequiredMissing.length > 0);
  assert.equal(assessment.coreRequiredComplete, false);
  assert.equal(assessment.customFieldStampRequired, true);
});

test("parseSa360CustomFieldIdMapJson ignores invalid entries", () => {
  assert.deepEqual(
    parseSa360CustomFieldIdMapJson({ sa360_lead_uid: "abc", bad: 1, empty: "" }),
    { sa360_lead_uid: "abc" }
  );
});

test("mergeSa360CustomFieldIdMaps destination wins on conflict", () => {
  const merged = mergeSa360CustomFieldIdMaps(
    { sa360_lead_uid: "dest" },
    { sa360_lead_uid: "env", sa360_routing_status: "env2" }
  );
  assert.equal(merged.sa360_lead_uid, "dest");
  assert.equal(merged.sa360_routing_status, "env2");
});

test("buildSa360CustomFieldKeyMapFromDiscovery maps logical keys to GHL fieldKey", () => {
  const fields: GhlDiscoveredCustomField[] = [
    {
      id: "ghl_uid",
      name: "Lead UID",
      key: "lead_uid",
      fieldKey: "contact.sa360_lead_uid",
      dataType: "TEXT",
    },
  ];
  const keyMap = buildSa360CustomFieldKeyMapFromDiscovery(fields);
  assert.equal(keyMap.sa360_lead_uid, "contact.sa360_lead_uid");
});

test("resolveSa360CustomFieldKeyMap prefers discovery and destination overrides", () => {
  const keyMap = resolveSa360CustomFieldKeyMap({
    destinationKeyMapJson: { sa360_lead_uid: "contact.override_key" },
    discoveredFields: [
      {
        id: "ghl_uid",
        name: "Lead UID",
        key: null,
        fieldKey: "contact.sa360_lead_uid",
        dataType: "TEXT",
      },
    ],
  });
  assert.equal(keyMap.sa360_lead_uid, "contact.override_key");
  assert.equal(keyMap.sa360_routing_status, "contact.sa360_routing_status");
});

test("auditSa360FieldMappingAgainstDiscovery flags saved field key instead of id", () => {
  const fields: GhlDiscoveredCustomField[] = [
    {
      id: "realGhlFieldId1234",
      name: "SA360 Lead UID",
      key: "sa360_lead_uid",
      fieldKey: "contact.sa360_lead_uid",
      dataType: "TEXT",
    },
  ];
  const rows = auditSa360FieldMappingAgainstDiscovery(
    { sa360_lead_uid: "contact.sa360_lead_uid" },
    fields
  );
  const leadRow = rows.find((r) => r.logicalKey === "sa360_lead_uid");
  assert.equal(leadRow?.mappingUsesFieldKey, true);
  assert.equal(leadRow?.writeIdentifierOk, false);
  assert.ok(leadRow?.issue?.includes("field key"));
});

test("auditSa360FieldMappingAgainstDiscovery confirms correct saved field id", () => {
  const fields: GhlDiscoveredCustomField[] = [
    {
      id: "realGhlFieldId1234",
      name: "SA360 Lead UID",
      key: "sa360_lead_uid",
      fieldKey: "contact.sa360_lead_uid",
      dataType: "TEXT",
    },
  ];
  const rows = auditSa360FieldMappingAgainstDiscovery(
    { sa360_lead_uid: "realGhlFieldId1234" },
    fields
  );
  const leadRow = rows.find((r) => r.logicalKey === "sa360_lead_uid");
  assert.equal(leadRow?.mappingUsesFieldId, true);
  assert.equal(leadRow?.writeIdentifierOk, true);
  assert.equal(leadRow?.ghlFieldKey, "contact.sa360_lead_uid");
  assert.equal(leadRow?.ghlFieldType, "TEXT");
});

test("assessCustomFieldStampReadiness flags option fields needing validation", () => {
  const readiness = assessCustomFieldStampReadiness({
    idMap: {
      sa360_lead_uid: "text1",
      sa360_routing_status: "opt1",
      sa360_lifecycle_stage: "opt2",
    },
    discoveredFields: [
      {
        id: "text1",
        name: "uid",
        key: null,
        fieldKey: "contact.sa360_lead_uid",
        dataType: "TEXT",
      },
      {
        id: "opt1",
        name: "status",
        key: null,
        fieldKey: "contact.sa360_routing_status",
        dataType: "SINGLE_OPTIONS",
      },
    ],
  });
  assert.equal(readiness.coreTextStampSafe, false);
  assert.ok(readiness.optionFieldsNeedValidation.includes("sa360_routing_status"));
});
