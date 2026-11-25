import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXTURE_NOW,
  FIXTURE_PII,
  contactStep,
  destinationFixture,
  opportunityFailed,
  outboxFixture,
  ownerFailed,
  runFixture,
  sourceLeadFixture,
  tagStep,
  workflowCompleted,
  workflowSkipped,
} from "../../test/delivery-diagnostics-fixtures.js";
import { buildGhlRunDiagnostic } from "./ghl-run-diagnostic.js";
import { classifyGhlDelivery, destinationState } from "./ghl-health.js";
import { deriveDrainStatus, type QueueSnapshot } from "./infra-health.js";
import { createConcurrencyGate, createFixedWindowRateLimiter } from "./limits.js";
import { sanitizeErrorText, sanitizedGhlErrorBody } from "./sanitize.js";
import { buildAttention } from "./summary.js";
import {
  decodeRunCursor,
  diagnosticsRunListQuerySchema,
  diagnosticsSummaryQuerySchema,
  encodeRunCursor,
  resolveDiagnosticWindow,
} from "./window.js";

function diagnose(input: {
  run?: Parameters<typeof runFixture>[0];
  destination?: Parameters<typeof destinationFixture>[0] | null;
  outbox?: Parameters<typeof outboxFixture>[0] | null;
}) {
  const run = runFixture(input.run);
  return buildGhlRunDiagnostic({
    run,
    destination: input.destination === null ? null : destinationFixture(input.destination),
    accountStatus: "active",
    outbox: input.outbox === null ? null : outboxFixture({ liveRunId: run.id, ...input.outbox }),
    sourceLead: sourceLeadFixture,
    onboardingTestAttemptKeys: [],
    onboardingTestAttemptId: null,
  });
}

function classify(diagnostic: ReturnType<typeof diagnose> | null, outbox = outboxFixture(), state = "live" as const) {
  return classifyGhlDelivery({ outbox, diagnostic, destinationState: state, accountStatus: "active", now: FIXTURE_NOW });
}

test("windows are the two named windows and nothing else", () => {
  const window = resolveDiagnosticWindow("7d", FIXTURE_NOW);
  assert.equal(window.hours, 168);
  assert.equal(window.to.getTime() - window.from.getTime(), 7 * 24 * 3600 * 1000);
  assert.equal(diagnosticsSummaryQuerySchema.parse({}).window, "24h");
  assert.equal(diagnosticsSummaryQuerySchema.safeParse({ window: "30d" }).success, false);
  assert.equal(diagnosticsSummaryQuerySchema.safeParse({ from: "2020-01-01" }).success, false);
  assert.equal(diagnosticsSummaryQuerySchema.safeParse({ clientAccountId: "a b" }).success, false);
  assert.equal(diagnosticsSummaryQuerySchema.safeParse({ clientAccountId: "x'; DROP TABLE y;--" }).success, false);
  assert.equal(diagnosticsSummaryQuerySchema.safeParse({ clientAccountId: "x".repeat(129) }).success, false);
});

test("run list limits and cursors are bounded and validated", () => {
  assert.equal(diagnosticsRunListQuerySchema.safeParse({ limit: "51" }).success, false);
  assert.equal(diagnosticsRunListQuerySchema.safeParse({ limit: "0" }).success, false);
  assert.equal(diagnosticsRunListQuerySchema.parse({}).limit, 25);
  const cursor = { startedAt: new Date("2026-11-25T11:00:00.000Z"), id: "run_1" };
  const decoded = decodeRunCursor(encodeRunCursor(cursor));
  assert.deepEqual(decoded, cursor);
  assert.equal(decodeRunCursor("not-base64-json"), "invalid");
  assert.equal(decodeRunCursor(Buffer.from(JSON.stringify({ t: "nope", i: "run_1" })).toString("base64url")), "invalid");
  assert.equal(decodeRunCursor(Buffer.from(JSON.stringify({ t: cursor.startedAt.toISOString(), i: "a b" })).toString("base64url")), "invalid");
  assert.equal(decodeRunCursor(undefined), null);
});

test("sanitizers scrub consumer identifiers and keep only whitelisted GHL error fields", () => {
  const scrubbed = sanitizeErrorText(`bad contact ${FIXTURE_PII} phone +15555550111`);
  assert.ok(scrubbed);
  assert.equal(scrubbed.includes(FIXTURE_PII), false);
  assert.equal(scrubbed.includes("5555550111"), false);
  const body = sanitizedGhlErrorBody({
    statusCode: 422,
    message: `contact ${FIXTURE_PII} invalid`,
    contact: { email: FIXTURE_PII },
    body: { phone: "+15555550111" },
  });
  const text = JSON.stringify(body);
  assert.equal(text.includes(FIXTURE_PII), false);
  assert.equal(text.includes("5555550111"), false);
  assert.equal(text.includes("contact\":"), false);
});

test("a required workflow that was skipped is a partial success with contact delivered and workflow incomplete", () => {
  const diagnostic = diagnose({
    run: { status: "partial_success", stepRuns: [contactStep(), tagStep(), workflowSkipped(), ownerFailed(4)] },
  });
  assert.equal(diagnostic.contact.result, "upserted");
  assert.equal(diagnostic.workflow.attempted, false);
  assert.equal(diagnostic.workflow.status, "skipped");
  assert.equal(diagnostic.workflow.requiredRecorded, true);
  assert.equal(diagnostic.verdict.contactReceived, true);
  assert.equal(diagnostic.verdict.canonical, false);
  assert.ok(diagnostic.verdict.canonicalReasons.some((reason) => reason.startsWith("workflow_")));
  assert.equal(diagnostic.retry.disposition, "hold");
  assert.equal(diagnostic.retry.automaticRetryPending, false);
  assert.equal(classify(diagnostic).class, "contact_delivered_required_workflow_incomplete");
  assert.equal(diagnostic.evidence.storedBodiesReturned, false);
  assert.equal(diagnostic.evidence.externalCallsMade, false);
});

test("an unrecorded workflow requirement is reported as unverified instead of guessed", () => {
  const diagnostic = diagnose({
    run: { status: "partial_success", workflowStartRequired: null, stepRuns: [contactStep(), tagStep(), workflowSkipped()] },
  });
  assert.equal(diagnostic.run.workflowStartRequiredRecorded, null);
  assert.equal(diagnostic.verdict.canonical, null);
  assert.equal(diagnostic.verdict.unverifiedReason, "workflow_requirement_unrecorded");
  assert.equal(classify(diagnostic).class, "contact_delivered_workflow_requirement_unrecorded");
});

test("a failed opportunity step never exposes the stored body or consumer fields", () => {
  const diagnostic = diagnose({
    destination: { opportunityCreationEnabled: true, destinationPipelineIdGhl: "pipe_1", destinationPipelineStageIdGhl: "stage_1" },
    run: { status: "failed", stepRuns: [contactStep(), tagStep(), opportunityFailed(3)] },
  });
  assert.equal(diagnostic.opportunity.status, "failed");
  assert.equal(diagnostic.opportunity.errorCode, "http_422");
  assert.equal(diagnostic.opportunity.httpStatus, 422);
  assert.equal(diagnostic.opportunity.stepExpectedByDestination, true);
  const text = JSON.stringify(diagnostic);
  assert.equal(text.includes(FIXTURE_PII), false);
  assert.equal(text.includes("5555550111"), false);
  assert.equal(text.includes("vetOperationReceipt"), false);
  const classified = classify(diagnostic);
  assert.equal(classified.class, "terminal_required_step_failure");
  assert.deepEqual(classified.failedRequiredSteps, [
    { stepType: "create_or_update_opportunity", errorCode: "http_422", httpStatus: 422 },
  ]);
});

test("a VET webform destination does not expect an opportunity step", () => {
  const diagnostic = diagnose({
    destination: {
      opportunityCreationEnabled: true,
      sourceEnrichmentPolicyJson: { lalAiBot1VetWebform: true },
    },
  });
  assert.equal(diagnostic.destinationConfig?.lalAiBot1VetWebform, true);
  assert.equal(diagnostic.destinationConfig?.opportunityStepExpected, false);
  assert.equal(diagnostic.opportunity.stepExpectedByDestination, false);
  assert.ok(diagnostic.destinationConfig?.workflowNameFromContract);
});

test("optional owner failure after a completed required path is a warning, not a failed contact delivery", () => {
  const diagnostic = diagnose({
    run: { status: "partial_success", stepRuns: [contactStep(), tagStep(), workflowCompleted(), ownerFailed(4)] },
  });
  assert.equal(diagnostic.verdict.contactReceived, true);
  assert.equal(diagnostic.verdict.canonical, true);
  assert.equal(classify(diagnostic).class, "delivered_optional_warnings");
});

test("a clean run is delivered_complete", () => {
  assert.equal(classify(diagnose({})).class, "delivered_complete");
});

test("outbox states classify without a run", () => {
  const pending = outboxFixture({ status: "pending", liveRunId: null, availableAt: new Date(FIXTURE_NOW.getTime() - 60_000) });
  assert.equal(classify(null, pending).class, "pending");
  const overdue = outboxFixture({ status: "pending", liveRunId: null, availableAt: new Date(FIXTURE_NOW.getTime() - 3_600_000) });
  assert.equal(classify(null, overdue).class, "pending_overdue");
  const stale = outboxFixture({ status: "executing", liveRunId: null, executingAt: new Date(FIXTURE_NOW.getTime() - 3_600_000) });
  assert.equal(classify(null, stale).class, "held_stale_executing");
  assert.equal(classify(null, outboxFixture({ status: "executing", liveRunId: null, executingAt: FIXTURE_NOW })).class, "in_flight");
  assert.equal(classify(null, outboxFixture({ status: "uncertain", liveRunId: null })).class, "held_uncertain");
});

test("shadow, disabled, and not-approved destinations are intentional non-delivery, not failure", () => {
  const settled = outboxFixture({ status: "settled", liveRunId: null, outcome: "skipped" });
  for (const state of ["shadow", "disabled", "not_approved", "not_configured", "location_mismatch"] as const) {
    const result = classify(null, settled, state);
    assert.equal(result.class, "intentional_non_delivery", state);
    assert.equal(result.code, state);
  }
  assert.equal(classify(null, settled, "live").class, "settled_without_run_unexplained");
});

test("destinationState distinguishes live, shadow, and disabled", () => {
  assert.equal(destinationState(destinationFixture(), "loc_fixture_1"), "live");
  assert.equal(destinationState(destinationFixture({ deliveryMode: "shadow" }), "loc_fixture_1"), "shadow");
  assert.equal(destinationState(destinationFixture({ deliveryEnabled: false }), "loc_fixture_1"), "disabled");
  assert.equal(destinationState(null, null), "not_configured");
  assert.equal(destinationState(destinationFixture(), "loc_other"), "location_mismatch");
});

test("rate limiter blocks after the cap and recovers in the next window", () => {
  const limiter = createFixedWindowRateLimiter({ max: 2, windowMs: 1000 });
  assert.equal(limiter.take("a", 0).allowed, true);
  assert.equal(limiter.take("a", 10).allowed, true);
  const blocked = limiter.take("a", 20);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  assert.equal(limiter.take("b", 20).allowed, true);
  assert.equal(limiter.take("a", 1500).allowed, true);
});

test("concurrency gate admits up to the cap and releases once", () => {
  const gate = createConcurrencyGate(1);
  const release = gate.tryEnter();
  assert.ok(release);
  assert.equal(gate.tryEnter(), null);
  release();
  release();
  assert.equal(gate.inFlight(), 0);
  assert.ok(gate.tryEnter());
});

function queue(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    queue: "ghl-association-dispatch",
    available: true,
    error: null,
    waiting: 0,
    active: 0,
    delayed: 1,
    prioritized: 0,
    paused: 0,
    failed: 0,
    stalledCandidates: 0,
    repeatableJobs: 1,
    oldestWaitingAt: null,
    lastCompletedAt: new Date(FIXTURE_NOW.getTime() - 30_000).toISOString(),
    connectedWorkers: 1,
    ...overrides,
  };
}

test("worker drain status is derived from the latest completed repeat job", () => {
  const base = { now: FIXTURE_NOW, staleMs: 300_000 };
  assert.equal(deriveDrainStatus({ ...base, expected: false, queue: queue() }), "not_scheduled");
  assert.equal(deriveDrainStatus({ ...base, expected: true, queue: queue() }), "ok");
  assert.equal(
    deriveDrainStatus({ ...base, expected: true, queue: queue({ lastCompletedAt: new Date(FIXTURE_NOW.getTime() - 3_600_000).toISOString() }) }),
    "stale"
  );
  assert.equal(deriveDrainStatus({ ...base, expected: true, queue: queue({ lastCompletedAt: null }) }), "no_completion_observed");
  assert.equal(deriveDrainStatus({ ...base, expected: true, queue: queue({ available: false }) }), "unknown");
});

test("attention flags terminal failures and incomplete required workflows but ignores optional warnings at info level", () => {
  const attention = buildAttention({
    intake: { available: false, error: "x" },
    sheets: { available: false, error: "x" },
    ghl: {
      available: true,
      data: {
        windowFlow: {
          byClass: {
            terminal_required_step_failure: 1,
            contact_delivered_required_workflow_incomplete: 2,
            delivered_optional_warnings: 3,
          },
        },
      },
    } as never,
    infrastructure: { available: false, error: "x" },
  });
  const find = (kind: string) => attention.find((entry) => entry.kind === kind);
  assert.equal(find("terminal_required_step_failure")?.severity, "critical");
  assert.equal(find("required_workflow_incomplete")?.count, 2);
  assert.equal(find("optional_warnings")?.severity, "info");
  assert.equal(find("held_uncertain"), undefined);
});
