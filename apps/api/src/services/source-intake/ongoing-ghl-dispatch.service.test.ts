import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ONGOING_GHL_EXECUTION_LEASE_MS,
  processDueOngoingGhlDispatches,
  type OngoingDrainDeps,
  type OngoingIntentRow,
} from "./ongoing-ghl-dispatch.service.js";
import type { OngoingDeliveryResult } from "./ongoing-ghl-delivery.service.js";

const now = new Date("2026-10-29T18:00:00.000Z");

function intent(overrides: Partial<OngoingIntentRow> = {}): OngoingIntentRow {
  return {
    id: "intent-1",
    status: "pending",
    clientAccountId: "alex_gross",
    sourceLeadEventId: "event-1",
    routingDryRunDecisionId: "decision-1",
    destinationLocationIdGhl: "yCziKRW26eFg8IXAQZ73",
    activationLocationIdGhl: "yCziKRW26eFg8IXAQZ73",
    activationWorkflowIdGhl: "workflow-1",
    activationPipelineIdGhl: "pipeline-1",
    activationStageIdGhl: "stage-1",
    leadDeliveryPlanId: null,
    liveRunId: null,
    availableAt: now,
    attemptCount: 0,
    lastError: null,
    outcomeClass: null,
    processingAt: null,
    createdAt: now,
    ...overrides,
  };
}

function memory(seed: OngoingIntentRow[], execute: () => Promise<OngoingDeliveryResult>) {
  const rows = seed.map((row) => ({ ...row }));
  let executes = 0;
  let clock = now;
  const deps: OngoingDrainDeps = {
    now: () => clock,
    liveWritesAllowed: async () => true,
    listProcessing: async (leaseCutoff) =>
      rows.filter(
        (row) => row.status === "processing" && (row.processingAt === null || row.processingAt < leaseCutoff)
      ),
    listDue: async (at) =>
      rows
        .filter((row) => (row.status === "pending" || row.status === "retryable") && row.availableAt <= at)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    claim: async (id, at) => {
      const row = rows.find((item) => item.id === id && (item.status === "pending" || item.status === "retryable"));
      if (!row) return false;
      row.status = "processing";
      row.processingAt = at;
      row.attemptCount += 1;
      return true;
    },
    save: async (id, patch) => {
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error("missing");
      Object.assign(row, patch);
    },
    loadRun: async () => null,
    activationStillMatches: async () => true,
    executeIntent: async () => {
      executes += 1;
      return execute();
    },
  };
  return {
    deps,
    rows,
    executions: () => executes,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    setLive(allowed: boolean) {
      deps.liveWritesAllowed = async () => allowed;
    },
  };
}

const delivered: OngoingDeliveryResult = {
  outcome: "executed",
  outcomeClass: "delivered",
  reason: "succeeded",
  planId: "plan-1",
  runId: "run-1",
  runStatus: "succeeded",
  omittedWarnings: [],
};

test("a restart between intake and dispatch retries a claim that never called GHL", async () => {
  const crashed = intent({
    status: "processing",
    processingAt: new Date(now.getTime() - ONGOING_GHL_EXECUTION_LEASE_MS - 1_000),
    attemptCount: 1,
    liveRunId: null,
  });
  const store = memory([crashed], async () => delivered);
  const first = await processDueOngoingGhlDispatches(store.deps, 5);
  assert.equal(first.executed, 1);
  assert.equal(store.executions(), 1);
  assert.equal(store.rows[0]?.status, "completed");
  assert.equal(store.rows[0]?.outcomeClass, "delivered");
  const second = await processDueOngoingGhlDispatches(store.deps, 5);
  assert.equal(second.executed, 0);
  assert.equal(store.executions(), 1);
});

test("a lease that expires after a live run starts is uncertain and is not retried", async () => {
  const crashed = intent({
    status: "processing",
    processingAt: new Date(now.getTime() - ONGOING_GHL_EXECUTION_LEASE_MS - 1_000),
    liveRunId: "run-started",
  });
  const store = memory([crashed], async () => delivered);
  store.deps.loadRun = async () => ({ id: "run-started", status: "executing", stepRuns: [] });
  const result = await processDueOngoingGhlDispatches(store.deps, 5);
  assert.equal(result.executed, 0);
  assert.equal(store.executions(), 0);
  assert.equal(store.rows[0]?.status, "uncertain");
  assert.equal(store.rows[0]?.outcomeClass, "uncertain");
});

test("runtime off does not claim a pending intent", async () => {
  const store = memory([intent()], async () => delivered);
  store.setLive(false);
  const result = await processDueOngoingGhlDispatches(store.deps, 5);
  assert.equal(result.runtime, "off");
  assert.equal(store.executions(), 0);
  assert.equal(store.rows[0]?.status, "pending");
  assert.equal(store.rows[0]?.attemptCount, 0);
});

test("a pre-send failure is retried and an uncertain failure is not", async () => {
  const preSend = memory([intent({ id: "pre" })], async () => ({
    outcome: "failed_pre_send",
    outcomeClass: "pre_send",
    reason: "pre_send_threw",
    planId: "plan-1",
    runId: "run-1",
    runStatus: "failed",
    omittedWarnings: [],
  }));
  await processDueOngoingGhlDispatches(preSend.deps, 5);
  assert.equal(preSend.rows[0]?.status, "retryable");
  assert.equal(preSend.rows[0]?.outcomeClass, "pre_send");
  preSend.advance(31_000);
  preSend.deps.executeIntent = async () => delivered;
  await processDueOngoingGhlDispatches(preSend.deps, 5);
  assert.equal(preSend.rows[0]?.status, "completed");

  const uncertain = memory([intent({ id: "uncertain" })], async () => ({
    outcome: "failed_uncertain",
    outcomeClass: "uncertain",
    reason: "execution_threw",
    planId: "plan-1",
    runId: "run-2",
    runStatus: "failed",
    omittedWarnings: [],
  }));
  await processDueOngoingGhlDispatches(uncertain.deps, 5);
  uncertain.advance(60_000);
  await processDueOngoingGhlDispatches(uncertain.deps, 5);
  assert.equal(uncertain.executions(), 1);
  assert.equal(uncertain.rows[0]?.status, "uncertain");
});

test("intake records the GHL intent inside the lead transaction and does not call GHL", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "source-intake-routing-persist.ts"), "utf8");
  const start = source.indexOf("await prisma.$transaction");
  const end = source.indexOf("const proofResult");
  const transaction = source.slice(start, end);
  assert.match(transaction, /recordOngoingGhlDispatchIntent/);
  assert.match(transaction, /recordCompanySheetsCampaignIntent/);
  assert.equal(source.includes("deliverOngoingAssociationFromIntake"), false);
  assert.equal(source.includes("executeLiveCanaryGhlSteps"), false);
});
