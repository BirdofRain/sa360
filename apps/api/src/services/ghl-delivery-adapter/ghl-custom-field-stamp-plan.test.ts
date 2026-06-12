import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTypedCustomFieldStampPlan,
  classifyGhlCustomFieldDataType,
  isValueAllowedForPicklist,
  resolveCustomFieldStampStepStatus,
} from "./ghl-custom-field-stamp-plan.js";
import type { GhlDiscoveredCustomField } from "../ghl-config-discovery/ghl-config-discovery.types.js";

const DISCOVERED: GhlDiscoveredCustomField[] = [
  {
    id: "textFieldId123456",
    name: "sa360_lead_uid",
    key: null,
    fieldKey: "contact.sa360_lead_uid",
    dataType: "TEXT",
  },
  {
    id: "optionFieldId12345",
    name: "sa360_routing_status",
    key: null,
    fieldKey: "contact.sa360_routing_status",
    dataType: "SINGLE_OPTIONS",
  },
  {
    id: "validatedOption1234",
    name: "sa360_lifecycle_stage",
    key: null,
    fieldKey: "contact.sa360_lifecycle_stage",
    dataType: "SINGLE_OPTIONS",
    picklistOptions: ["NEW", "CONTACTED"],
  },
];

test("classifyGhlCustomFieldDataType distinguishes TEXT and SINGLE_OPTIONS", () => {
  assert.equal(classifyGhlCustomFieldDataType("TEXT"), "text_safe");
  assert.equal(classifyGhlCustomFieldDataType("SINGLE_OPTIONS"), "option");
});

test("buildTypedCustomFieldStampPlan puts TEXT in first batch and skips unvalidated options", () => {
  const plan = buildTypedCustomFieldStampPlan({
    idMap: {
      sa360_lead_uid: "textFieldId123456",
      sa360_routing_status: "optionFieldId12345",
      sa360_lifecycle_stage: "validatedOption1234",
    },
    values: {
      sa360_lead_uid: "lead_abc",
      sa360_routing_status: "LIVE_CANARY_DELIVERED",
      sa360_lifecycle_stage: "NEW",
    },
    discoveredFields: DISCOVERED,
  });

  assert.equal(plan.textBatch.apiPayload.length, 1);
  assert.equal(plan.textBatch.apiPayload[0]?.field_value, "lead_abc");
  assert.equal(plan.optionBatch.apiPayload.length, 1);
  assert.equal(plan.optionBatch.diagnostics[0]?.logicalKey, "sa360_lifecycle_stage");
  assert.deepEqual(plan.attemptedTextFields, ["sa360_lead_uid"]);
  assert.ok(plan.skippedOptionFields.includes("sa360_routing_status"));
  assert.ok(
    plan.skipped.some(
      (s) => s.logicalKey === "sa360_routing_status" && s.reason === "option_mapping_missing"
    )
  );
});

test("invalid option value without mapping does not enter option batch", () => {
  const plan = buildTypedCustomFieldStampPlan({
    idMap: { sa360_lifecycle_stage: "validatedOption1234" },
    values: { sa360_lifecycle_stage: "NOT_A_VALID_OPTION" },
    discoveredFields: DISCOVERED,
  });
  assert.equal(plan.textBatch.apiPayload.length, 0);
  assert.equal(plan.optionBatch.apiPayload.length, 0);
  assert.ok(
    plan.skipped.some(
      (s) =>
        s.reason === "option_mapping_missing" || s.reason === "option_value_not_in_allowed_list"
    )
  );
});

test("option map translates lifecycle NEW to GHL new before stamp", () => {
  const plan = buildTypedCustomFieldStampPlan({
    idMap: { sa360_lifecycle_stage: "validatedOption1234" },
    values: { sa360_lifecycle_stage: "NEW" },
    optionMap: { sa360_lifecycle_stage: { NEW: "new" } },
    discoveredFields: [
      {
        ...DISCOVERED[2]!,
        picklistOptions: ["new", "contacted"],
      },
    ],
  });
  assert.equal(plan.optionBatch.apiPayload.length, 1);
  assert.equal(plan.optionBatch.apiPayload[0]?.field_value, "new");
});

test("isValueAllowedForPicklist matches case-insensitively", () => {
  assert.equal(isValueAllowedForPicklist("new", ["NEW", "CONTACTED"]), true);
  assert.equal(isValueAllowedForPicklist("BAD", ["NEW"]), false);
});

test("resolveCustomFieldStampStepStatus returns partial_success when TEXT ok and options skipped", () => {
  const resolution = resolveCustomFieldStampStepStatus({
    stampRequired: false,
    textAttempted: true,
    textOk: true,
    optionAttempted: false,
    optionOk: true,
    textBatchCount: 1,
    optionBatchCount: 0,
    skipped: [
      {
        logicalKey: "sa360_routing_status",
        dataType: "SINGLE_OPTIONS",
        reason: "option_mapping_missing",
        message: "Missing option mapping: sa360_routing_status LIVE_CANARY_DELIVERED",
        isCoreRequired: true,
      },
    ],
    unsatisfiedRequiredCoreFields: ["sa360_routing_status"],
    textErrorDetail: null,
    optionErrorDetail: null,
  });
  assert.equal(resolution.status, "partial_success");
  assert.ok(resolution.warnings[0]?.includes("Missing option mapping"));
});

test("resolveCustomFieldStampStepStatus fails required stamp when core option fields cannot validate", () => {
  const resolution = resolveCustomFieldStampStepStatus({
    stampRequired: true,
    textAttempted: true,
    textOk: true,
    optionAttempted: false,
    optionOk: true,
    textBatchCount: 1,
    optionBatchCount: 0,
    skipped: [],
    unsatisfiedRequiredCoreFields: ["sa360_routing_status"],
    textErrorDetail: null,
    optionErrorDetail: null,
  });
  assert.equal(resolution.status, "failed");
});

test("TEXT batch failure does not imply option batch attempted", () => {
  const resolution = resolveCustomFieldStampStepStatus({
    stampRequired: false,
    textAttempted: true,
    textOk: false,
    optionAttempted: false,
    optionOk: true,
    textBatchCount: 2,
    optionBatchCount: 1,
    skipped: [],
    unsatisfiedRequiredCoreFields: [],
    textErrorDetail: "invalid custom field",
    optionErrorDetail: null,
  });
  assert.equal(resolution.status, "optional_failed");
});
