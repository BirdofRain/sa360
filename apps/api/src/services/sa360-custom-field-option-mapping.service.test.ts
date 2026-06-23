import test from "node:test";
import assert from "node:assert/strict";
import { SA360_DEMO_CUSTOM_FIELD_OPTION_MAP } from "@sa360/shared";
import {
  assessSa360OptionMappingReadiness,
  formatMissingOptionMappingMessage,
  mapCanonicalToGhlOptionValue,
  mergeSa360CustomFieldOptionMaps,
  parseSa360CustomFieldOptionMapJson,
  resolveOptionFieldStampValue,
} from "./sa360-custom-field-option-mapping.service.js";
import { buildTypedCustomFieldStampPlan } from "./ghl-delivery-adapter/ghl-custom-field-stamp-plan.js";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery/ghl-config-discovery.types.js";

const OPTION_FIELDS: GhlDiscoveredCustomField[] = [
  {
    id: "lifecycleId123456",
    name: "sa360_lifecycle_stage",
    key: null,
    fieldKey: "contact.sa360_lifecycle_stage",
    dataType: "SINGLE_OPTIONS",
    picklistOptions: ["new", "dead"],
  },
  {
    id: "routingId12345678",
    name: "sa360_routing_status",
    key: null,
    fieldKey: "contact.sa360_routing_status",
    dataType: "SINGLE_OPTIONS",
    picklistOptions: ["none", "assigned"],
  },
  {
    id: "nicheId123456789",
    name: "sa360_niche_key",
    key: null,
    fieldKey: "contact.sa360_niche_key",
    dataType: "SINGLE_OPTIONS",
    picklistOptions: ["n_vet", "n_fex"],
  },
];

test("mapCanonicalToGhlOptionValue maps lifecycle NEW to new and niche VET to n_vet", () => {
  const map = SA360_DEMO_CUSTOM_FIELD_OPTION_MAP;
  assert.equal(mapCanonicalToGhlOptionValue("sa360_lifecycle_stage", "NEW", map), "new");
  assert.equal(mapCanonicalToGhlOptionValue("sa360_niche_key", "VET", map), "n_vet");
});

test("routing_status CREATED without explicit mapping is missing", () => {
  const map = SA360_DEMO_CUSTOM_FIELD_OPTION_MAP;
  assert.equal(mapCanonicalToGhlOptionValue("sa360_routing_status", "CREATED", map), null);
  assert.equal(
    formatMissingOptionMappingMessage("sa360_routing_status", "CREATED"),
    "Missing option mapping: sa360_routing_status CREATED"
  );
});

test("explicit CREATED to none mapping works only when configured", () => {
  const map = mergeSa360CustomFieldOptionMaps(
    { sa360_routing_status: { CREATED: "none" } },
    SA360_DEMO_CUSTOM_FIELD_OPTION_MAP
  );
  assert.equal(mapCanonicalToGhlOptionValue("sa360_routing_status", "CREATED", map), "none");
  const resolved = resolveOptionFieldStampValue({
    logicalKey: "sa360_routing_status",
    canonicalValue: "CREATED",
    optionMap: map,
    discovered: OPTION_FIELDS[1],
  });
  assert.equal(resolved.ghlValue, "none");
});

test("buildTypedCustomFieldStampPlan stamps mapped option values in option batch", () => {
  const plan = buildTypedCustomFieldStampPlan({
    idMap: {
      sa360_lifecycle_stage: "lifecycleId123456",
      sa360_routing_status: "routingId12345678",
      sa360_niche_key: "nicheId123456789",
    },
    values: {
      sa360_lifecycle_stage: "NEW",
      sa360_routing_status: "CREATED",
      sa360_niche_key: "VET",
    },
    optionMap: {
      ...SA360_DEMO_CUSTOM_FIELD_OPTION_MAP,
      sa360_routing_status: {
        ...SA360_DEMO_CUSTOM_FIELD_OPTION_MAP.sa360_routing_status,
        CREATED: "none",
      },
    },
    discoveredFields: OPTION_FIELDS,
  });

  assert.equal(plan.textBatch.apiPayload.length, 0);
  assert.equal(plan.optionBatch.apiPayload.length, 3);
  assert.equal(plan.optionBatch.apiPayload[0]?.field_value, "new");
  assert.equal(
    plan.optionBatch.apiPayload.find((p) => p.key.includes("niche"))?.field_value,
    "n_vet"
  );
  assert.ok(
    plan.skipped.some(
      (s) => s.logicalKey === "sa360_routing_status" && s.reason !== "option_mapping_missing"
    ) === false
  );
});

test("buildTypedCustomFieldStampPlan blocks CREATED when mapping missing", () => {
  const plan = buildTypedCustomFieldStampPlan({
    idMap: { sa360_routing_status: "routingId12345678" },
    values: { sa360_routing_status: "CREATED" },
    optionMap: SA360_DEMO_CUSTOM_FIELD_OPTION_MAP,
    discoveredFields: OPTION_FIELDS,
  });
  assert.equal(plan.optionBatch.apiPayload.length, 0);
  assert.ok(
    plan.skipped.some(
      (s) =>
        s.logicalKey === "sa360_routing_status" &&
        s.reason === "option_mapping_missing" &&
        s.message.includes("CREATED")
    )
  );
});

test("parseSa360CustomFieldOptionMapJson ignores invalid entries", () => {
  const parsed = parseSa360CustomFieldOptionMapJson({
    sa360_niche_key: { VET: "n_vet", "": "bad" },
    bad: "not-an-object",
  });
  assert.deepEqual(parsed.sa360_niche_key, { VET: "n_vet" });
});

test("niche_key alias map supports VET and N_VET both mapping to N_VET", () => {
  // Mirrors Vet Life — James Torrey destination optionMapJson after adding the VET alias.
  const optionMap = { sa360_niche_key: { VET: "N_VET", N_VET: "N_VET" } };
  const nicheField: GhlDiscoveredCustomField = {
    id: "nicheId123456789",
    name: "sa360_niche_key",
    key: null,
    fieldKey: "contact.sa360_niche_key",
    dataType: "SINGLE_OPTIONS",
    picklistOptions: ["N_VET", "N_FEX"],
  };

  assert.equal(mapCanonicalToGhlOptionValue("sa360_niche_key", "VET", optionMap), "N_VET");
  assert.equal(mapCanonicalToGhlOptionValue("sa360_niche_key", "N_VET", optionMap), "N_VET");

  const vet = resolveOptionFieldStampValue({
    logicalKey: "sa360_niche_key",
    canonicalValue: "VET",
    optionMap,
    discovered: nicheField,
  });
  assert.equal(vet.ghlValue, "N_VET");
  assert.equal(vet.reason, "mapped");

  const legacy = resolveOptionFieldStampValue({
    logicalKey: "sa360_niche_key",
    canonicalValue: "N_VET",
    optionMap,
    discovered: nicheField,
  });
  assert.equal(legacy.ghlValue, "N_VET");

  // An unmapped dropdown value still produces a missing mapping (no silent guessing).
  const assessment = assessSa360OptionMappingReadiness({
    optionMap,
    discoveredFields: [nicheField],
    valuesToStamp: { sa360_niche_key: "MTG" },
  });
  assert.equal(assessment.missingMappings.length, 1);
  assert.equal(assessment.missingMappings[0]?.canonicalValue, "MTG");
});

test("stamp plan maps source value VET to GHL option N_VET via alias map", () => {
  const plan = buildTypedCustomFieldStampPlan({
    idMap: { sa360_niche_key: "nicheId123456789" },
    values: { sa360_niche_key: "VET" },
    optionMap: { sa360_niche_key: { VET: "N_VET", N_VET: "N_VET" } },
    discoveredFields: [
      {
        id: "nicheId123456789",
        name: "sa360_niche_key",
        key: null,
        fieldKey: "contact.sa360_niche_key",
        dataType: "SINGLE_OPTIONS",
        picklistOptions: ["N_VET", "N_FEX"],
      },
    ],
  });
  assert.equal(plan.optionBatch.apiPayload.length, 1);
  assert.equal(plan.optionBatch.apiPayload[0]?.field_value, "N_VET");
  assert.equal(
    plan.skipped.some((s) => s.reason === "option_mapping_missing"),
    false
  );
});

test("assessSa360OptionMappingReadiness reports missing CREATED mapping", () => {
  const assessment = assessSa360OptionMappingReadiness({
    optionMap: SA360_DEMO_CUSTOM_FIELD_OPTION_MAP,
    discoveredFields: OPTION_FIELDS,
    valuesToStamp: { sa360_routing_status: "CREATED" },
  });
  assert.equal(assessment.missingMappings.length, 1);
  assert.equal(assessment.missingMappings[0]?.canonicalValue, "CREATED");
});
