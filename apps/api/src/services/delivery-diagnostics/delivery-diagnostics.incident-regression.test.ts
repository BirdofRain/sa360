import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXTURE_CLIENT,
  FIXTURE_LEAD,
  FIXTURE_NOW,
  FIXTURE_RUN,
  contactStep,
  destinationFixture,
  outboxFixture,
  runFixture,
  sourceLeadFixture,
  step,
  tagStep,
  workflowSkipped,
} from "../../test/delivery-diagnostics-fixtures.js";
import { outboxTerminalFromDelivery } from "../ghl-association-dispatch/ghl-association-dispatch.js";
import { deriveLiveCanaryRunStatus } from "../ghl-delivery-adapter/ghl-live-canary-step-requirements.js";
import { deliveryRetryDisposition } from "../ghl-delivery-adapter/vet-ghl-delivery-contract.js";
import { buildGhlRunDiagnostic, type StoredOutboxForDiagnostic } from "./ghl-run-diagnostic.js";
import { classifyGhlDelivery, loadGhlHealth } from "./ghl-health.js";
import { buildAttention } from "./summary.js";
import type { DiagnosticsDb } from "./read-only.js";
import { resolveDiagnosticWindow } from "./window.js";

/**
 * Shape of the Jason Newman 10:01 PM association delivery: the contact upsert
 * succeeded with a durable id, the required opportunity create was rejected
 * with HTTP 400, workflow enrollment was skipped, and the run is held from
 * retry. Run status, retry disposition, and the outbox row are derived from
 * the production functions instead of being chosen by the fixture.
 */
const opportunityRejected400 = (order = 3) =>
  step(
    {
      stepType: "create_or_update_opportunity",
      status: "failed",
      errorCode: "http_400",
      errorSummary: "pipelineStageId must be a string",
      responseRedactedJson: {
        externalCallExecuted: true,
        statusCode: 400,
        message: ["pipelineStageId must be a string"],
        vetOperationReceipt: {
          operation: "opportunity",
          outcome: "rejected",
          externalId: null,
          httpStatus: 400,
          idempotencyKey: "assoc:opportunity",
        },
      },
    },
    order
  );

const incidentSteps = () => [
  contactStep(1),
  tagStep(2),
  opportunityRejected400(3),
  { ...workflowSkipped(4), errorSummary: "Workflow skipped — opportunity creation did not succeed." },
];

const incidentDestination = destinationFixture({
  opportunityCreationEnabled: true,
  destinationPipelineIdGhl: "pipe_1",
  destinationPipelineStageIdGhl: "stage_1",
  workflowStartRequired: true,
});

function incident() {
  const steps = incidentSteps();
  const runStatus = deriveLiveCanaryRunStatus({
    stepOutcomes: steps,
    flags: { ownerRequired: false, workflowRequired: true, stampRequired: false },
    contactIdGhl: "contact_1",
    opportunityConfigured: true,
  });
  const run = runFixture({ status: runStatus, workflowStartRequired: true, stepRuns: steps });
  const settlement = outboxTerminalFromDelivery({
    outcome: "executed",
    reason: runStatus,
    runId: run.id,
    status: runStatus,
    externalCallExecuted: true,
  });
  assert.equal(settlement.action, "settle");
  if (settlement.action !== "settle") throw new Error("unreachable");
  const outbox: StoredOutboxForDiagnostic = outboxFixture({
    status: settlement.status,
    outcome: settlement.outcome,
    lastError: settlement.lastError,
    externalCallExecuted: settlement.externalCallExecuted,
    liveRunId: settlement.liveRunId,
    settledAt: settlement.status === "settled" ? FIXTURE_NOW : null,
  });
  return { run, outbox, runStatus };
}

test("the incident shape is what production stores: failed run, held from retry, uncertain outbox", () => {
  const { run, outbox, runStatus } = incident();
  assert.equal(runStatus, "failed");
  assert.equal(deliveryRetryDisposition(run), "hold");
  assert.equal(outbox.status, "uncertain");
  assert.equal(outbox.outcome, "failed");
  assert.equal(outbox.lastError, "failed");
});

test("the incident is classified as a required-step failure, with the held retry reported separately", () => {
  const { run, outbox } = incident();
  const diagnostic = buildGhlRunDiagnostic({
    run,
    destination: incidentDestination,
    accountStatus: "active",
    outbox,
    sourceLead: sourceLeadFixture,
    onboardingTestAttemptKeys: [],
    onboardingTestAttemptId: null,
  });

  assert.equal(diagnostic.contact.externalId, "contact_1");
  assert.equal(diagnostic.verdict.contactReceived, true);
  assert.equal(diagnostic.verdict.canonical, false);
  assert.equal(diagnostic.opportunity.status, "failed");
  assert.equal(diagnostic.opportunity.httpStatus, 400);
  assert.equal(diagnostic.workflow.status, "skipped");
  assert.equal(diagnostic.workflow.attempted, false);
  assert.equal(diagnostic.retry.disposition, "hold");
  assert.equal(diagnostic.retry.automaticRetryPending, false);
  assert.equal(diagnostic.retry.outbox?.status, "uncertain");

  const classified = classifyGhlDelivery({
    outbox,
    diagnostic,
    destinationState: "live",
    accountStatus: "active",
    now: FIXTURE_NOW,
  });
  assert.equal(classified.class, "terminal_required_step_failure");
  assert.deepEqual(classified.failedRequiredSteps, [
    { stepType: "create_or_update_opportunity", errorCode: "http_400", httpStatus: 400 },
  ]);
  assert.notEqual(classified.class, "intentional_non_delivery");
});

test("a failed opportunity stays required when the destination stopped creating opportunities after the run", () => {
  const { run, outbox } = incident();
  const diagnostic = buildGhlRunDiagnostic({
    run,
    destination: { ...incidentDestination, opportunityCreationEnabled: false },
    accountStatus: "active",
    outbox,
    sourceLead: sourceLeadFixture,
    onboardingTestAttemptKeys: [],
    onboardingTestAttemptId: null,
  });
  const opportunity = diagnostic.steps.find((item) => item.stepType === "create_or_update_opportunity");
  assert.equal(opportunity?.required, true);
  assert.equal(
    diagnostic.contributors.find((item) => item.stepType === "create_or_update_opportunity")?.effect,
    "required_step_incomplete"
  );
});

test("a genuinely unknown outcome without a stored run is still held_uncertain", () => {
  const unknown = outboxFixture({ status: "uncertain", outcome: "uncertain", lastError: "external_outcome_unknown", liveRunId: null });
  const classified = classifyGhlDelivery({
    outbox: unknown,
    diagnostic: null,
    destinationState: "live",
    accountStatus: "active",
    now: FIXTURE_NOW,
  });
  assert.equal(classified.class, "held_uncertain");
});

function fakeDb(input: { outbox: StoredOutboxForDiagnostic & { id: string }; run: ReturnType<typeof runFixture> }): DiagnosticsDb {
  const none = async () => [];
  return {
    ghlAssociationDispatchOutbox: {
      findMany: async () => [input.outbox],
      groupBy: async () =>
        ["pending", "executing", "uncertain"].includes(input.outbox.status)
          ? [{ status: input.outbox.status, _count: { _all: 1 } }]
          : [],
      findFirst: async () => null,
    },
    ghlLiveDeliveryRun: {
      findMany: async () => [input.run],
      findFirst: async () => null,
      groupBy: none,
    },
    clientGhlDestination: { findMany: async () => [incidentDestination] },
    clientAccount: { findMany: async () => [{ clientAccountId: FIXTURE_CLIENT, status: "active" }] },
    sourceLeadEvent: { findMany: async () => [sourceLeadFixture] },
    clientOnboardingTestAttemptKey: { findMany: none },
    clientOnboardingTestAttempt: { findMany: none },
  } as unknown as DiagnosticsDb;
}

test("the GHL summary counts the incident as a terminal failure and never as a completed required workflow", async () => {
  const { run, outbox } = incident();
  const health = await loadGhlHealth(fakeDb({ outbox: { ...outbox, id: "outbox_1" }, run }), {
    window: resolveDiagnosticWindow("24h", FIXTURE_NOW),
    now: FIXTURE_NOW,
    clientAccountId: null,
    campaignLeadIds: { ids: null, capped: false },
  });
  const flow = health.windowFlow;
  assert.equal(flow.byClass.terminal_required_step_failure, 1);
  assert.equal(flow.byClass.held_uncertain ?? 0, 0);
  assert.equal(flow.terminalRequiredStepFailures, 1);
  assert.equal(flow.intentionalNonDelivery.shadow ?? 0, 0);
  assert.equal(flow.verifiedContactFulfillment, 1);
  assert.equal(flow.canonicalDeliveries, 0);
  assert.equal(flow.requiredWorkflow.required, 1);
  assert.equal(flow.requiredWorkflow.completed, 0);
  assert.equal(flow.requiredWorkflow.incomplete, 1);
  assert.equal(health.openWork.uncertain, 1);
  assert.equal(health.attention.length, 1);
  assert.equal(health.attention[0]?.runId, FIXTURE_RUN);
  assert.equal(health.attention[0]?.sourceLeadEventId, FIXTURE_LEAD);
  assert.deepEqual(health.attention[0]?.failedRequiredSteps, [
    { stepType: "create_or_update_opportunity", errorCode: "http_400", httpStatus: 400 },
  ]);

  const attention = buildAttention({
    intake: { available: false, error: "x" },
    sheets: { available: false, error: "x" },
    ghl: { available: true, data: health },
    infrastructure: { available: false, error: "x" },
  });
  assert.equal(attention.find((entry) => entry.kind === "terminal_required_step_failure")?.count, 1);
  assert.equal(attention.find((entry) => entry.kind === "terminal_required_step_failure")?.severity, "critical");
});
