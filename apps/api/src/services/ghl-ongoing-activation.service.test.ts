import assert from "node:assert/strict";
import test from "node:test";

import {
  assessOngoingGhlActivation,
  setOngoingGhlDeliveryActivation,
  type OngoingActivationDestination,
} from "./ghl-ongoing-activation.service.js";

function destination(overrides: Partial<OngoingActivationDestination> = {}): OngoingActivationDestination {
  return {
    destinationSubaccountIdGhl: "yCziKRW26eFg8IXAQZ73",
    ghlConnectionStatus: "connected",
    destinationWorkflowIdGhl: "d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd",
    workflowTriggerMode: "direct_api",
    opportunityCreationEnabled: true,
    destinationPipelineIdGhl: "pipeline-1",
    destinationPipelineStageIdGhl: "stage-1",
    ...overrides,
  };
}

test("enabling ongoing delivery requires confirmation, a connection, a workflow, and a pipeline", () => {
  const denied = assessOngoingGhlActivation({
    enabled: true,
    confirmLiveDeliveryRisk: false,
    destination: destination(),
  });
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.code, "CONFIRMATION_REQUIRED");

  const disconnected = assessOngoingGhlActivation({
    enabled: true,
    confirmLiveDeliveryRisk: true,
    destination: destination({ ghlConnectionStatus: "error" }),
  });
  assert.equal(disconnected.ok, false);
  if (disconnected.ok) return;
  assert.equal(disconnected.code, "NOT_CONNECTED");

  const noWorkflow = assessOngoingGhlActivation({
    enabled: true,
    confirmLiveDeliveryRisk: true,
    destination: destination({ destinationWorkflowIdGhl: null }),
  });
  assert.equal(noWorkflow.ok, false);
  if (noWorkflow.ok) return;
  assert.equal(noWorkflow.code, "WORKFLOW_REQUIRED");

  const enabled = assessOngoingGhlActivation({
    enabled: true,
    confirmLiveDeliveryRisk: true,
    destination: destination(),
  });
  assert.equal(enabled.ok, true);
  if (!enabled.ok) return;
  assert.deepEqual(enabled.patch, {
    deliveryEnabled: true,
    deliveryMode: "live",
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
  });
});

test("pausing clears the four authorization flags and does not require a workflow", () => {
  const paused = assessOngoingGhlActivation({
    enabled: false,
    confirmLiveDeliveryRisk: true,
    destination: destination({ destinationWorkflowIdGhl: null, ghlConnectionStatus: "error" }),
  });
  assert.equal(paused.ok, true);
  if (!paused.ok) return;
  assert.equal(paused.patch.deliveryEnabled, false);
  assert.equal(paused.patch.deliveryMode, "shadow");
  assert.equal(paused.patch.clientCutoverApproved, false);
  assert.equal(paused.patch.internalApprovalStatus, "not_reviewed");
});

test("activation persists the flags and an audit row without an allowlist lookup", async () => {
  const seen: {
    patch: unknown;
    audit: { action: string; metadata: Record<string, unknown> } | null;
  } = { patch: null, audit: null };
  const result = await setOngoingGhlDeliveryActivation(
    {
      clientAccountId: "alex_gross",
      enabled: true,
      confirmLiveDeliveryRisk: true,
      actorLabel: "coc_admin",
    },
    {
      findClient: async () => ({
        clientAccountId: "alex_gross",
        ghlDestination: {
          destinationSubaccountIdGhl: "yCziKRW26eFg8IXAQZ73",
          ghlConnectionStatus: "connected",
          destinationWorkflowIdGhl: "workflow-1",
          workflowTriggerMode: "direct_api",
          opportunityCreationEnabled: true,
          destinationPipelineIdGhl: "pipeline-1",
          destinationPipelineStageIdGhl: "stage-1",
        },
      }),
      updateDestination: async (_id, next) => {
        seen.patch = next;
      },
      writeAudit: async (row) => {
        seen.audit = { action: row.action, metadata: { ...row.metadata } };
      },
    }
  );
  assert.equal("ok" in result && result.ok, true);
  assert.deepEqual(seen.patch, {
    deliveryEnabled: true,
    deliveryMode: "live",
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
  });
  assert.equal(seen.audit?.action, "ghl_ongoing_delivery_enabled");
  assert.equal(seen.audit?.metadata.locationId, "yCziKRW26eFg8IXAQZ73");
  assert.equal(seen.audit?.metadata.sendsLead, false);
  assert.equal(JSON.stringify(seen.audit).includes("SA360_DIRECT_DELIVERY"), false);
});
