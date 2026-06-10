import test from "node:test";
import assert from "node:assert/strict";
import { SA360_CORE_REQUIRED_FIELD_KEYS } from "../../lib/sa360-custom-field-keys.js";
import {
  buildMergedSa360FieldMapForGhlConfigSave,
  checkRoutingRuleGhlLocationMismatch,
} from "./routing-rule-ghl-config.service.js";
import { buildFieldMappingSaveReport } from "../sa360-custom-field-mapping.service.js";
import { evaluateDeliveryReadiness } from "../delivery-readiness.service.js";
import { GHL_CONNECTION_CONNECTED } from "../../lib/delivery-readiness-status.js";
import type { DeliveryReadinessRuleInput } from "../delivery-readiness.service.js";

function fullRule(overrides: Partial<DeliveryReadinessRuleInput> = {}): DeliveryReadinessRuleInput {
  return {
    id: "rule_1",
    masterClientAccountId: "master_1",
    clientAccountId: "client_account_test",
    destinationSubaccountIdGhl: "ghl_location_test",
    destinationWorkflowIdGhl: "wf_1",
    destinationPipelineIdGhl: "pipe_1",
    destinationPipelineStageIdGhl: "stage_1",
    defaultAssignedUserIdGhl: "user_1",
    backupSheetEnabled: false,
    backupSheetId: null,
    ghlConnectionStatus: GHL_CONNECTION_CONNECTED,
    snapshotInstalled: true,
    requiredFieldsInstalled: true,
    deliveryMode: "shadow",
    deliveryEnabled: false,
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
    opportunityCreationEnabled: true,
    active: true,
    ...overrides,
  };
}

test("save config rejects location mismatch unless confirmed", () => {
  assert.ok(checkRoutingRuleGhlLocationMismatch("loc_rule", "loc_other"));
  assert.equal(checkRoutingRuleGhlLocationMismatch("loc_rule", "loc_other", true), null);
});

test("saved GHL config clears workflow and pipeline missing config", () => {
  const assessment = evaluateDeliveryReadiness(fullRule());
  assert.ok(!assessment.missingConfig.includes("destinationWorkflowIdGhl"));
  assert.ok(!assessment.missingConfig.includes("destinationPipelineIdGhl"));
  assert.ok(!assessment.missingConfig.includes("destinationPipelineStageIdGhl"));
});

test("save config does not imply live delivery when only shadow fields set", () => {
  const assessment = evaluateDeliveryReadiness(
    fullRule({
      deliveryEnabled: false,
      deliveryMode: "shadow",
      internalApprovalStatus: "not_reviewed",
    })
  );
  assert.equal(assessment.canDeliverLive, false);
  assert.equal(assessment.readinessStatus, "ready_for_live");
});

test("revoked synthetic location readiness is not_delivery_capable via missing ghl", () => {
  const assessment = evaluateDeliveryReadiness(
    fullRule({ ghlConnectionStatus: "revoked" })
  );
  assert.ok(assessment.blockers.some((b) => /GHL connection/i.test(b)));
});

test("buildMergedSa360FieldMapForGhlConfigSave persists discovery logical keys to field IDs", () => {
  const fields = SA360_CORE_REQUIRED_FIELD_KEYS.map((key, index) => ({
    id: `ghl_${index}`,
    name: key,
    key: null,
    fieldKey: `contact.${key}`,
    dataType: "TEXT",
  }));
  const merged = buildMergedSa360FieldMapForGhlConfigSave({
    snapFields: [],
    discoveryCustomFields: fields,
    existingDest: null,
    bodyMapJson: undefined,
  });
  for (const key of SA360_CORE_REQUIRED_FIELD_KEYS) {
    assert.ok(merged[key], `expected ${key} in merged map`);
  }
  const report = buildFieldMappingSaveReport(merged, false);
  assert.equal(report.source, "destination_config");
  assert.equal(report.coreMappedCount, SA360_CORE_REQUIRED_FIELD_KEYS.length);
  assert.equal(report.coreMissing.length, 0);
});

test("buildMergedSa360FieldMapForGhlConfigSave preserves existing mappings on partial discovery", () => {
  const merged = buildMergedSa360FieldMapForGhlConfigSave({
    snapFields: [
      {
        id: "ghl_new",
        name: "Lead UID",
        key: null,
        fieldKey: "contact.sa360_lead_uid",
        dataType: "TEXT",
      },
    ],
    existingDest: {
      sa360CustomFieldIdMapJson: { sa360_campaign_id: "ghl_existing_campaign" },
    } as never,
    bodyMapJson: undefined,
  });
  assert.equal(merged.sa360_lead_uid, "ghl_new");
  assert.equal(merged.sa360_campaign_id, "ghl_existing_campaign");
});
