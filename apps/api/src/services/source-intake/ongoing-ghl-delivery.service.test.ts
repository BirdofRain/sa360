import assert from "node:assert/strict";
import test from "node:test";

import type { LiveCanaryExecutionResult } from "../ghl-delivery-adapter/ghl-live-canary-executor.service.js";
import {
  deliverOngoingAssociationLead,
  ghlOmissionWarnings,
  ongoingDeliveryPayloadBlockers,
  ongoingRunBlocksAnotherWrite,
  persistedGhlDestinationAuthorized,
  type OngoingDeliveryPlanRef,
  type OngoingGhlDeliveryDeps,
  type OngoingGhlDestinationAuth,
  type OngoingRunSnapshot,
} from "./ongoing-ghl-delivery.service.js";

const LOCATION = "yCziKRW26eFg8IXAQZ73";

function destination(overrides: Partial<OngoingGhlDestinationAuth> = {}): OngoingGhlDestinationAuth {
  return {
    clientAccountId: "alex_gross",
    destinationSubaccountIdGhl: LOCATION,
    ghlConnectionStatus: "connected",
    deliveryEnabled: true,
    deliveryMode: "live",
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
    destinationWorkflowIdGhl: "d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd",
    workflowTriggerMode: "direct_api",
    opportunityCreationEnabled: true,
    destinationPipelineIdGhl: "pipeline-1",
    destinationPipelineStageIdGhl: "stage-1",
    sourceAttributeFieldMapJson: {},
    ...overrides,
  };
}

function plan(): OngoingDeliveryPlanRef {
  return {
    id: "plan-1",
    status: "planned",
    planVersion: "2.0-direct-canary",
    masterClientAccountId: "leadcapture_io",
    destinationClientAccountId: "alex_gross",
    destinationSubaccountIdGhl: LOCATION,
    sourceLeadUid: "lead-1",
    sourceEmail: "ada@example.invalid",
    sourcePhoneE164: "+15555550100",
    routingDryRunDecisionId: "decision-1",
  };
}

function execution(status: LiveCanaryExecutionResult["runStatus"] = "succeeded"): LiveCanaryExecutionResult {
  return {
    contactIdGhl: "contact-1",
    opportunityIdGhl: "opp-1",
    workflowStarted: true,
    stepOutcomes: [],
    runStatus: status,
    summary: status,
    errors: [],
    warnings: [],
  };
}

function harness(overrides: Partial<OngoingGhlDeliveryDeps> = {}) {
  const calls = {
    generate: 0,
    execute: 0,
    create: 0,
    fail: 0,
    complete: 0,
    omitted: [] as string[],
  };
  const deps: OngoingGhlDeliveryDeps = {
    findDestination: async () => destination(),
    liveWritesAllowed: async () => true,
    findPlan: async () => plan(),
    generatePlan: async () => {
      calls.generate += 1;
      return { plan: plan() };
    },
    findRun: async () => null,
    createRun: async () => {
      calls.create += 1;
      return { id: "run-1", status: "executing", stepRuns: [] };
    },
    reuseRun: async (id) => ({ id, status: "executing", stepRuns: [] }),
    execute: async () => {
      calls.execute += 1;
      return execution();
    },
    completeRun: async (_id, _started, _execution, omitted) => {
      calls.complete += 1;
      calls.omitted = omitted;
    },
    failRun: async () => {
      calls.fail += 1;
    },
    now: () => new Date("2026-10-29T16:00:00.000Z"),
    ...overrides,
  };
  return { deps, calls };
}

const input = {
  sourceLeadEventId: "event-1",
  status: "routing_matched",
  routing: {
    matched: true,
    matchedRuleId: null,
    destinationClientAccountId: "alex_gross",
    destinationLocationIdGhl: LOCATION,
    routingDryRunDecisionId: "decision-1",
    routingAuthority: "confirmed_source_association",
  },
  duplicateBlocksLiveDelivery: false,
  email: "ada@example.invalid",
  phone: "+15555550100",
  attributeKeys: ["primary_reason", "branch_of_service"],
};

test("persisted destination authorization ignores environment allowlists", () => {
  assert.equal(persistedGhlDestinationAuthorized(destination()), true);
  assert.equal(persistedGhlDestinationAuthorized(destination({ deliveryEnabled: false })), false);
  assert.equal(persistedGhlDestinationAuthorized(destination({ deliveryMode: "shadow" })), false);
  assert.equal(persistedGhlDestinationAuthorized(destination({ clientCutoverApproved: false })), false);
  assert.equal(persistedGhlDestinationAuthorized(destination({ internalApprovalStatus: "not_reviewed" })), false);
  assert.equal(persistedGhlDestinationAuthorized(destination({ ghlConnectionStatus: "disconnected" })), false);
  assert.equal(persistedGhlDestinationAuthorized(null), false);
});

test("empty GHL field map is reported as omitted and a mapped key is not", () => {
  const empty = ghlOmissionWarnings({}, ["primary_reason"]);
  assert.match(empty[0] ?? "", /primary_reason/);
  assert.match(empty[0] ?? "", /not written/);
  const mapped = ghlOmissionWarnings(
    { primary_reason: "contact.primary_concern" },
    ["primary_reason", "branch_of_service"]
  );
  assert.match(mapped[0] ?? "", /branch_of_service/);
  assert.equal(mapped[0]?.includes("primary_reason"), false);
});

test("workflow and pipeline gaps block before a write", () => {
  assert.deepEqual(
    ongoingDeliveryPayloadBlockers(destination({ destinationWorkflowIdGhl: null }), {
      email: "ada@example.invalid",
      phone: null,
    }),
    ["workflow_not_selected"]
  );
  assert.deepEqual(
    ongoingDeliveryPayloadBlockers(destination(), { email: null, phone: null }),
    ["missing_contact_channel"]
  );
});

test("a failed run with an external call is not retried and a pre-write failure is", () => {
  const wrote: OngoingRunSnapshot = {
    id: "run-1",
    status: "failed",
    stepRuns: [{ responseRedactedJson: { externalCallExecuted: true } }],
  };
  const thrown: OngoingRunSnapshot = { id: "run-2", status: "failed", stepRuns: [] };
  const preWrite: OngoingRunSnapshot = {
    id: "run-3",
    status: "failed",
    stepRuns: [{ responseRedactedJson: { externalCallExecuted: false } }],
  };
  assert.equal(ongoingRunBlocksAnotherWrite(wrote), true);
  assert.equal(ongoingRunBlocksAnotherWrite(thrown), true);
  assert.equal(ongoingRunBlocksAnotherWrite({ id: "run-4", status: "executing", stepRuns: [] }), true);
  assert.equal(ongoingRunBlocksAnotherWrite(preWrite), false);
  assert.equal(ongoingRunBlocksAnotherWrite(null), false);
});

test("unauthorized, campaign-rule, and runtime-off leads do not create a plan or write", async () => {
  const off = harness({ findDestination: async () => destination({ deliveryEnabled: false }) });
  const unauthorized = await deliverOngoingAssociationLead(input, off.deps);
  assert.equal(unauthorized.reason, "destination_not_authorized");
  assert.equal(off.calls.generate, 0);
  assert.equal(off.calls.execute, 0);

  const ruled = harness();
  const campaign = await deliverOngoingAssociationLead(
    { ...input, routing: { ...input.routing, matchedRuleId: "rule-james" } },
    ruled.deps
  );
  assert.equal(campaign.reason, "not_confirmed_association");
  assert.equal(ruled.calls.generate, 0);

  const simulate = harness({ liveWritesAllowed: async () => false });
  const paused = await deliverOngoingAssociationLead(input, simulate.deps);
  assert.equal(paused.reason, "runtime_not_live");
  assert.equal(simulate.calls.generate, 0);
  assert.equal(simulate.calls.execute, 0);
});

test("an authorized association executes once and records omitted fields", async () => {
  const { deps, calls } = harness({ findPlan: async () => null });
  const result = await deliverOngoingAssociationLead(input, deps);
  assert.equal(result.outcome, "executed");
  assert.equal(result.runStatus, "succeeded");
  assert.equal(calls.generate, 1);
  assert.equal(calls.execute, 1);
  assert.equal(calls.create, 1);
  assert.match(calls.omitted[0] ?? "", /primary_reason/);
  assert.match(calls.omitted[0] ?? "", /branch_of_service/);
});

test("a prior succeeded run does not execute again", async () => {
  const { deps, calls } = harness({
    findRun: async () => ({ id: "run-old", status: "succeeded", stepRuns: [] }),
  });
  const result = await deliverOngoingAssociationLead(input, deps);
  assert.equal(result.outcome, "skipped_duplicate");
  assert.equal(calls.execute, 0);
  assert.equal(calls.create, 0);
});

test("a thrown write is stored as uncertain and is not presented as success", async () => {
  const { deps, calls } = harness({
    execute: async () => {
      throw new Error("socket hang up");
    },
  });
  const result = await deliverOngoingAssociationLead(input, deps);
  assert.equal(result.outcome, "failed_uncertain");
  assert.equal(calls.fail, 1);
  assert.equal(calls.complete, 0);
});

test("duplicate protection and a location mismatch never call GHL", async () => {
  const duplicate = harness();
  const blocked = await deliverOngoingAssociationLead(
    { ...input, duplicateBlocksLiveDelivery: true },
    duplicate.deps
  );
  assert.equal(blocked.reason, "duplicate_blocks_live");
  assert.equal(duplicate.calls.execute, 0);

  const wrongLocation = harness();
  const mismatch = await deliverOngoingAssociationLead(
    {
      ...input,
      routing: { ...input.routing, destinationLocationIdGhl: "other-location" },
    },
    wrongLocation.deps
  );
  assert.equal(mismatch.reason, "location_mismatch");
  assert.equal(wrongLocation.calls.execute, 0);
});
