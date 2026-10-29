import assert from "node:assert/strict";
import test from "node:test";

import {
  deliverConfirmedAssociationIfActivated,
  executeSelectedGhlDeliveryTest,
  type AssociationDeliveryDeps,
} from "./association-ongoing-delivery.js";
import { DELIVER_ONE_GHL_TEST } from "./ghl-destination-authorization.js";

const LOCATION = "loc_sam_test";
const CLIENT = "client_sam";

function facts(overrides: Record<string, unknown> = {}) {
  return {
    clientDisplayName: "Sam",
    locationId: LOCATION,
    workflowId: "wf_1",
    workflowTriggerMode: "direct_api",
    deliveryEnabled: true,
    deliveryMode: "live",
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
    linkedToClient: true,
    connectionStatus: "connected",
    otherActivated: false,
    omittedCoreFields: ["sa360_campaign_id"],
    omittedOptionalFields: ["sa360_niche_key"],
    ...overrides,
  };
}

function plan() {
  return {
    id: "plan_1",
    destinationClientAccountId: CLIENT,
    destinationSubaccountIdGhl: LOCATION,
    routingDryRunDecisionId: "dec_1",
  };
}

function deps(overrides: Partial<AssociationDeliveryDeps> = {}): AssociationDeliveryDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    loadDestination: async () => facts(),
    runtimeCanExecute: async () => true,
    duplicateBlocks: async () => false,
    findPlan: async (id) => (id === "dec_1" || id === "plan_1" ? plan() : null),
    createPlan: async () => {
      calls.push("create");
      return { ok: true, plan: plan() };
    },
    findRun: async () => null,
    execute: async (input) => {
      calls.push(`execute:${input.mode}:${input.reuseRunId ?? "new"}`);
      return { held: false, status: "succeeded", runId: "run_1", externalCallExecuted: true, errors: [] };
    },
    ...overrides,
  };
}

test("an unactivated association does not create a plan or call GHL", async () => {
  const gate = deps({ loadDestination: async () => facts({ deliveryEnabled: false }) });
  const result = await deliverConfirmedAssociationIfActivated(
    {
      sourceLeadEventId: "evt_1",
      status: "routing_matched",
      routing: {
        matched: true,
        routingAuthority: "confirmed_source_association",
        routingDryRunDecisionId: "dec_1",
        destinationClientAccountId: CLIENT,
        destinationLocationIdGhl: LOCATION,
      },
    },
    gate
  );
  assert.equal(result.outcome, "skipped");
  assert.equal(result.reason, "destination_not_activated");
  assert.deepEqual(gate.calls, []);
});

test("an activated association creates one plan and records one GHL outcome", async () => {
  const gate = deps({ findPlan: async () => null });
  const result = await deliverConfirmedAssociationIfActivated(
    {
      sourceLeadEventId: "evt_1",
      status: "routing_matched",
      routing: {
        matched: true,
        routingAuthority: "confirmed_source_association",
        routingDryRunDecisionId: "dec_1",
        destinationClientAccountId: CLIENT,
        destinationLocationIdGhl: LOCATION,
      },
    },
    gate
  );
  assert.equal(result.outcome, "executed");
  assert.equal(result.externalCallExecuted, true);
  assert.deepEqual(result.omittedCoreFields, ["sa360_campaign_id"]);
  assert.deepEqual(gate.calls, ["create", "execute:ongoing_association:new"]);
});

test("a GHL failure is recorded without throwing, and an uncertain run is not sent again", async () => {
  const gate = deps({
    execute: async () => {
      throw new Error("transport");
    },
  });
  const failed = await deliverConfirmedAssociationIfActivated(
    {
      sourceLeadEventId: "evt_1",
      status: "routing_matched",
      routing: {
        matched: true,
        routingAuthority: "confirmed_source_association",
        routingDryRunDecisionId: "dec_1",
        destinationClientAccountId: CLIENT,
        destinationLocationIdGhl: LOCATION,
      },
    },
    gate
  );
  assert.equal(failed.reason, "delivery_failed");
  assert.equal(failed.externalCallExecuted, false);

  let executes = 0;
  const held = deps({
    findRun: async () => ({
      id: "run_uncertain",
      status: "failed",
      stepRuns: [{ errorCode: "http_transport", responseRedactedJson: { externalCallExecuted: true } }],
    }),
    execute: async () => {
      executes += 1;
      return { held: false, status: "succeeded", runId: "run_2", externalCallExecuted: true, errors: [] };
    },
  });
  const second = await deliverConfirmedAssociationIfActivated(
    {
      sourceLeadEventId: "evt_1",
      status: "routing_matched",
      routing: {
        matched: true,
        routingAuthority: "confirmed_source_association",
        routingDryRunDecisionId: "dec_1",
        destinationClientAccountId: CLIENT,
        destinationLocationIdGhl: LOCATION,
      },
    },
    held
  );
  assert.equal(second.outcome, "held");
  assert.equal(executes, 0);
});

test("a selected test does not send an event that already has a GHL delivery record", async () => {
  let executes = 0;
  const gate = deps({
    findRun: async () => ({
      id: "run_done",
      status: "succeeded",
      stepRuns: [{ errorCode: null, responseRedactedJson: { externalCallExecuted: true } }],
    }),
    execute: async () => {
      executes += 1;
      return { held: false, status: "succeeded", runId: "run_2", externalCallExecuted: true, errors: [] };
    },
  });
  const held = await executeSelectedGhlDeliveryTest(
    { clientAccountId: CLIENT, planId: "plan_1", confirmation: DELIVER_ONE_GHL_TEST },
    gate
  );
  assert.equal(held.outcome, "held");
  assert.equal(held.externalCallExecuted, false);
  assert.equal(executes, 0);
});

test("a selected test loads the stored lead and does not turn ongoing delivery on", async () => {
  let seen: { mode: string; lifecycle: boolean; confirmation: string | null } | null = null;
  const gate = deps({
    loadDestination: async () => facts({ deliveryEnabled: false, deliveryMode: "shadow", clientCutoverApproved: false }),
    loadLifecyclePayload: async () => ({ schema_version: "sa360.lifecycle.v1" }) as never,
    execute: async (input) => {
      seen = {
        mode: input.mode,
        lifecycle: Boolean(input.lifecyclePayload),
        confirmation: input.confirmation,
      };
      return { held: false, status: "succeeded", runId: "run_test", externalCallExecuted: true, errors: [] };
    },
  });
  const sent = await executeSelectedGhlDeliveryTest(
    { clientAccountId: CLIENT, planId: "plan_1", confirmation: DELIVER_ONE_GHL_TEST },
    gate
  );
  assert.equal(sent.outcome, "executed");
  assert.deepEqual(seen, {
    mode: "paused_location_test",
    lifecycle: true,
    confirmation: DELIVER_ONE_GHL_TEST,
  });
  assert.equal(gate.calls.includes("create"), false);
});

test("a selected test can run before ongoing delivery is enabled and does not require the env allowlist", async () => {
  const gate = deps({ loadDestination: async () => facts({ deliveryEnabled: false, deliveryMode: "shadow" }) });
  const refused = await executeSelectedGhlDeliveryTest(
    { clientAccountId: CLIENT, planId: "plan_1", confirmation: "no" },
    gate
  );
  assert.equal(refused.statusCode, 400);
  const sent = await executeSelectedGhlDeliveryTest(
    { clientAccountId: CLIENT, planId: "plan_1", confirmation: DELIVER_ONE_GHL_TEST },
    gate
  );
  assert.equal(sent.outcome, "executed");
  assert.equal(sent.statusCode, 200);
  assert.ok(gate.calls.includes("execute:paused_location_test:new"));
  assert.equal(gate.calls.includes("create"), false);
});

test("a pre-call failure can retry the same run, and a second client location is refused", async () => {
  const gate = deps({
    findRun: async () => ({
      id: "run_validation",
      status: "failed",
      stepRuns: [{ errorCode: "validation", responseRedactedJson: { externalCallExecuted: false } }],
    }),
  });
  const retried = await deliverConfirmedAssociationIfActivated(
    {
      sourceLeadEventId: "evt_2",
      status: "routing_matched",
      routing: {
        matched: true,
        routingAuthority: "confirmed_source_association",
        routingDryRunDecisionId: "dec_1",
        destinationClientAccountId: CLIENT,
        destinationLocationIdGhl: LOCATION,
      },
    },
    gate
  );
  assert.equal(retried.outcome, "executed");
  assert.ok(gate.calls.includes("execute:ongoing_association:run_validation"));

  const foreign = deps({ loadDestination: async () => facts({ otherActivated: true }) });
  const blocked = await deliverConfirmedAssociationIfActivated(
    {
      sourceLeadEventId: "evt_3",
      status: "routing_matched",
      routing: {
        matched: true,
        routingAuthority: "confirmed_source_association",
        routingDryRunDecisionId: "dec_1",
        destinationClientAccountId: CLIENT,
        destinationLocationIdGhl: LOCATION,
      },
    },
    foreign
  );
  assert.equal(blocked.reason, "location_owned_by_other_client");
  assert.deepEqual(foreign.calls, []);
});
