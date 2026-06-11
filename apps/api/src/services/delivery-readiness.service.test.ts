import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDeliveryReadiness } from "./delivery-readiness.service.js";
import { assertLiveDeliveryAllowed, LiveDeliveryNotAllowedError } from "./delivery-guard.js";
import { GHL_CONNECTION_CONNECTED } from "../lib/delivery-readiness-status.js";

const baseReady = {
  id: "rule_1",
  masterClientAccountId: "master_1",
  clientAccountId: "client_dest",
  destinationSubaccountIdGhl: "loc_dest",
  clientDisplayName: "Agent A",
  destinationWorkflowIdGhl: "wf_1",
  destinationPipelineIdGhl: "pipe_1",
  destinationPipelineStageIdGhl: "stage_1",
  defaultAssignedUserIdGhl: "user_1",
  backupSheetEnabled: false,
  backupSheetId: null,
  ghlConnectionStatus: GHL_CONNECTION_CONNECTED,
  snapshotInstalled: true,
  requiredFieldsInstalled: true,
  deliveryMode: "live",
  deliveryEnabled: true,
  clientCutoverApproved: true,
  internalApprovalStatus: "approved",
  opportunityCreationEnabled: true,
  active: true,
};

test("readiness returns not_ready for missing destination", () => {
  const a = evaluateDeliveryReadiness({
    ...baseReady,
    clientAccountId: "",
    destinationSubaccountIdGhl: "",
  });
  assert.equal(a.readyForShadow, false);
  assert.equal(a.readinessStatus, "not_ready");
  assert.ok(a.blockers.some((b) => b.includes("clientAccountId")));
});

test("readiness returns needs_config for missing workflow", () => {
  const a = evaluateDeliveryReadiness({
    ...baseReady,
    destinationWorkflowIdGhl: null,
    deliveryEnabled: false,
    deliveryMode: "shadow",
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
  });
  assert.equal(a.readyForShadow, true);
  assert.equal(a.readyForLive, false);
  assert.ok(a.missingConfig.includes("destinationWorkflowIdGhl"));
});

test("readiness readyForDirectCanary without deliveryEnabled or approvals", () => {
  const a = evaluateDeliveryReadiness({
    ...baseReady,
    destinationWorkflowIdGhl: null,
    defaultAssignedUserIdGhl: null,
    deliveryEnabled: false,
    deliveryMode: "shadow",
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
  });
  assert.equal(a.readyForDirectCanary, true);
  assert.equal(a.canDeliverLive, false);
  assert.ok(a.blockers.some((b) => b.includes("deliveryEnabled")));
});

test("readiness returns ready_for_shadow when destination exists", () => {
  const a = evaluateDeliveryReadiness({
    masterClientAccountId: "master_1",
    clientAccountId: "client_dest",
    destinationSubaccountIdGhl: "loc_dest",
    deliveryEnabled: false,
    deliveryMode: "shadow",
    internalApprovalStatus: "not_reviewed",
  });
  assert.equal(a.readyForShadow, true);
  assert.equal(a.canDeliverLive, false);
  assert.equal(a.readinessStatus, "ready_for_shadow");
});

test("readiness blocks live when deliveryEnabled false", () => {
  const a = evaluateDeliveryReadiness({ ...baseReady, deliveryEnabled: false });
  assert.equal(a.canDeliverLive, false);
  assert.ok(a.blockers.some((b) => b.includes("deliveryEnabled")));
});

test("readiness blocks live when cutover not approved", () => {
  const a = evaluateDeliveryReadiness({ ...baseReady, clientCutoverApproved: false });
  assert.equal(a.canDeliverLive, false);
  assert.ok(a.blockers.some((b) => b.includes("clientCutoverApproved")));
});

test("readiness blocks live when internalApprovalStatus not approved", () => {
  const a = evaluateDeliveryReadiness({
    ...baseReady,
    internalApprovalStatus: "ready_for_review",
  });
  assert.equal(a.canDeliverLive, false);
});

test("readiness allows live only with all required flags", () => {
  const a = evaluateDeliveryReadiness(baseReady);
  assert.equal(a.canDeliverLive, true);
  assert.equal(a.readinessStatus, "live_enabled");
});

test("readiness blocks live when backup sheet enabled without id", () => {
  const a = evaluateDeliveryReadiness({
    ...baseReady,
    backupSheetEnabled: true,
    backupSheetId: null,
  });
  assert.equal(a.canDeliverLive, false);
});

test("assertLiveDeliveryAllowed throws when unsafe", () => {
  assert.throws(
    () =>
      assertLiveDeliveryAllowed({
        masterClientAccountId: "m1",
        clientAccountId: "c1",
        destinationSubaccountIdGhl: "loc",
        deliveryEnabled: false,
      }),
    LiveDeliveryNotAllowedError
  );
});

test("assertLiveDeliveryAllowed passes when fully ready", () => {
  const a = assertLiveDeliveryAllowed(baseReady);
  assert.equal(a.canDeliverLive, true);
});

test("readiness warns on missing core field mapping when stamp not required", () => {
  const a = evaluateDeliveryReadiness({
    ...baseReady,
    deliveryEnabled: false,
    deliveryMode: "shadow",
    sa360CustomFieldIdMapJson: { sa360_lead_uid: "field_1" },
    customFieldStampRequired: false,
  });
  assert.ok(a.fieldMapping.coreRequiredMissing.length > 0);
  assert.ok(a.warnings.some((w) => w.includes("SA360 core field mapping missing")));
  assert.ok(!a.blockers.some((b) => b.includes("SA360 core field mapping missing")));
});

test("readiness blocks live when core field mapping missing and stamp required", () => {
  const a = evaluateDeliveryReadiness({
    ...baseReady,
    sa360CustomFieldIdMapJson: { sa360_lead_uid: "field_1" },
    customFieldStampRequired: true,
  });
  assert.ok(a.blockers.some((b) => b.includes("SA360 core field mapping missing")));
  assert.equal(a.canDeliverLive, false);
});

test("readiness includes field mapping assessment with core counts", () => {
  const keys = {
    sa360_lead_uid: "f1",
    sa360_client_account_id: "f2",
    sa360_lifecycle_stage: "f3",
    sa360_routing_status: "f4",
    sa360_backend_sync_status: "f5",
    sa360_delivery_plan_id: "f6",
    sa360_delivery_run_id: "f7",
    sa360_event_uuid: "f8",
    sa360_utm_campaign: "f9",
    sa360_campaign_id: "f10",
    sa360_source_platform: "f11",
  };
  const a = evaluateDeliveryReadiness({
    ...baseReady,
    sa360CustomFieldIdMapJson: keys,
    customFieldStampRequired: true,
  });
  assert.equal(a.fieldMapping.coreRequiredComplete, true);
  assert.equal(a.fieldMapping.coreRequiredMissing.length, 0);
});
