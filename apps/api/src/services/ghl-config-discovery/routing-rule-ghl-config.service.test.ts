import test from "node:test";
import assert from "node:assert/strict";
import { checkRoutingRuleGhlLocationMismatch } from "./routing-rule-ghl-config.service.js";
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
