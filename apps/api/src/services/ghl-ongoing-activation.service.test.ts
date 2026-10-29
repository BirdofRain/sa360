import assert from "node:assert/strict";
import test from "node:test";

import {
  assessOngoingGhlActivation,
  setOngoingGhlDeliveryActivation,
  type OngoingActivationDestination,
  type OngoingActivationWrite,
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

const discovered = {
  workflowsJson: [{ id: "workflow-1", name: "Welcome", status: "published", type: null }],
  pipelinesJson: [{ id: "pipeline-1", name: "Leads", stages: [{ id: "stage-1", name: "New", position: 0 }] }],
};

test("activation persists the flags, the resource snapshot, and an audit row", async () => {
  const seen: {
    patch: OngoingActivationWrite | null;
    audit: { action: string; metadata: Record<string, unknown> } | null;
  } = { patch: null, audit: null };
  const notBefore = new Date("2026-10-29T16:40:00.000Z");
  const result = await setOngoingGhlDeliveryActivation(
    {
      clientAccountId: "alex_gross",
      enabled: true,
      confirmLiveDeliveryRisk: true,
      actorLabel: "coc_admin",
    },
    {
      now: () => notBefore,
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
          ongoingDeliveryNotBefore: null,
        },
      }),
      findSnapshot: async () => discovered,
      updateDestination: async (_id, next) => {
        seen.patch = next;
      },
      writeAudit: async (row) => {
        seen.audit = { action: row.action, metadata: { ...row.metadata } };
      },
    }
  );
  assert.equal("ok" in result && result.ok, true);
  assert.equal(seen.patch?.deliveryEnabled, true);
  assert.equal(seen.patch?.deliveryMode, "live");
  assert.equal(seen.patch?.clientCutoverApproved, true);
  assert.equal(seen.patch?.internalApprovalStatus, "approved");
  assert.equal(seen.patch?.activationLocationIdGhl, "yCziKRW26eFg8IXAQZ73");
  assert.equal(seen.patch?.activationWorkflowIdGhl, "workflow-1");
  assert.equal(seen.patch?.activationPipelineIdGhl, "pipeline-1");
  assert.equal(seen.patch?.activationStageIdGhl, "stage-1");
  assert.equal(seen.patch?.ongoingDeliveryNotBefore?.toISOString(), notBefore.toISOString());
  assert.equal(seen.audit?.action, "ghl_ongoing_delivery_enabled");
  assert.equal(seen.audit?.metadata.locationId, "yCziKRW26eFg8IXAQZ73");
  assert.equal(seen.audit?.metadata.sendsLead, false);
  assert.equal(JSON.stringify(seen.audit).includes("SA360_DIRECT_DELIVERY"), false);
});

test("activation refuses a workflow that is not on the location snapshot", async () => {
  const result = await setOngoingGhlDeliveryActivation(
    { clientAccountId: "alex_gross", enabled: true, confirmLiveDeliveryRisk: true },
    {
      now: () => new Date("2026-10-29T16:40:00.000Z"),
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
          ongoingDeliveryNotBefore: null,
        },
      }),
      findSnapshot: async () => ({ ...discovered, workflowsJson: [] }),
      updateDestination: async () => {
        throw new Error("should not persist");
      },
      writeAudit: async () => {
        throw new Error("should not audit");
      },
    }
  );
  assert.equal("ok" in result && result.ok, false);
  if (!("ok" in result) || result.ok) return;
  assert.equal(result.code, "WORKFLOW_NOT_IN_LOCATION");
});

test("a second enable does not move the delivery boundary", async () => {
  const existing = new Date("2026-10-29T16:00:00.000Z");
  const seen: { write: OngoingActivationWrite | null } = { write: null };
  await setOngoingGhlDeliveryActivation(
    { clientAccountId: "alex_gross", enabled: true, confirmLiveDeliveryRisk: true },
    {
      now: () => new Date("2026-10-29T18:00:00.000Z"),
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
          ongoingDeliveryNotBefore: existing,
        },
      }),
      findSnapshot: async () => discovered,
      updateDestination: async (_id, next) => {
        seen.write = next;
      },
      writeAudit: async () => undefined,
    }
  );
  assert.equal(seen.write?.ongoingDeliveryNotBefore, undefined);
  assert.equal(seen.write?.deliveryEnabled, true);
});
