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
