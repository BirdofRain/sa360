import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  associationDispatchRecovery,
  outboxTerminalFromDelivery,
  presentAssociationDispatchVisibility,
  processDueGhlAssociationDispatches,
  recordGhlAssociationDispatchOutbox,
} from "./ghl-association-dispatch.js";

const now = new Date("2026-10-29T19:10:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-1",
    status: "pending",
    sourceLeadEventId: "evt-1",
    clientAccountId: "alex_gross",
    routingDryRunDecisionId: "decision-1",
    destinationLocationIdGhl: "yCziKRW26eFg8IXAQZ73",
    executingAt: null,
    ...overrides,
  };
}

test("a committed pending row with no run is delivered once", () => {
  assert.equal(
    associationDispatchRecovery({ status: "pending", executingAt: null, run: null, now }),
    "deliver"
  );
});

test("an already sent run is settled without another delivery", () => {
  assert.equal(
    associationDispatchRecovery({
      status: "pending",
      executingAt: null,
      run: { status: "partial_success", stepRuns: [{ errorCode: null, responseRedactedJson: { externalCallExecuted: true } }] },
      now,
    }),
    "settle_without_delivery"
  );
});

test("an executing live run is uncertain and is not delivered", () => {
  assert.equal(
    associationDispatchRecovery({
      status: "executing",
      executingAt: new Date(now.getTime() - 120_000),
      run: { status: "executing", stepRuns: [] },
      now,
    }),
    "mark_uncertain"
  );
});

test("a crash with no recorded run is uncertain after the lease", () => {
  assert.equal(
    associationDispatchRecovery({
      status: "executing",
      executingAt: new Date(now.getTime() - 120_000),
      run: null,
      now,
    }),
    "mark_uncertain"
  );
  assert.equal(
    associationDispatchRecovery({
      status: "executing",
      executingAt: new Date(now.getTime() - 1_000),
      run: null,
      now,
    }),
    "wait"
  );
});

test("a proven pre-send failure can be retried after the lease and an external failure cannot", () => {
  assert.equal(
    associationDispatchRecovery({
      status: "executing",
      executingAt: new Date(now.getTime() - 120_000),
      run: { status: "failed", stepRuns: [{ errorCode: "plan_required", responseRedactedJson: {} }] },
      now,
    }),
    "deliver"
  );
  assert.equal(
    associationDispatchRecovery({
      status: "executing",
      executingAt: new Date(now.getTime() - 120_000),
      run: {
        status: "failed",
        stepRuns: [{ errorCode: "http_500", responseRedactedJson: { externalCallExecuted: true } }],
      },
      now,
    }),
    "settle_without_delivery"
  );
});

test("a failed external call is uncertain and a pre-send failure stays executing", () => {
  const external = outboxTerminalFromDelivery({
    outcome: "executed",
    reason: "failed",
    runId: "run-failed",
    status: "failed",
    externalCallExecuted: true,
  });
  assert.equal(external.action, "settle");
  if (external.action === "settle") {
    assert.equal(external.status, "uncertain");
    assert.equal(external.outcome, "failed");
    assert.equal(external.lastError, "failed");
  }
  assert.deepEqual(
    outboxTerminalFromDelivery({
      outcome: "executed",
      reason: "failed",
      runId: "run-local",
      status: "failed",
      externalCallExecuted: false,
    }),
    { action: "leave_executing" }
  );
  const crashed = outboxTerminalFromDelivery({
    outcome: "skipped",
    reason: "delivery_failed",
    runId: null,
    status: null,
    externalCallExecuted: false,
  });
  assert.equal(crashed.action, "settle");
  if (crashed.action === "settle") assert.equal(crashed.status, "uncertain");
});

test("visibility lists status counts and does not add payload fields", () => {
  const presented = presentAssociationDispatchVisibility({
    counts: [
      { status: "pending", count: 2 },
      { status: "uncertain", count: 1 },
      { status: "settled", count: 4 },
    ],
    failed: 1,
    rows: [
      {
        id: "outbox-1",
        status: "uncertain",
        outcome: "failed",
        lastError: "failed",
        attemptCount: 1,
        sourceLeadEventId: "evt-1",
        clientAccountId: "alex_gross",
        externalCallExecuted: true,
        liveRunId: "run-1",
        availableAt: now,
        executingAt: now,
        settledAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  assert.deepEqual(presented.counts, { pending: 2, executing: 0, settled: 4, uncertain: 1, failed: 1 });
  assert.equal(presented.rows.length, 1);
  assert.equal("normalizedPayloadJson" in presented.rows[0], false);
  assert.equal(presented.rows[0]?.outcome, "failed");
  assert.equal(presented.rows[0]?.createdAt, now.toISOString());
});

test("processDue does not call deliver when the run is already held", async () => {
  let deliveries = 0;
  const settled: string[] = [];
  const result = await processDueGhlAssociationDispatches({
    now,
    listDue: async () => [row()],
    claim: async () => {
      throw new Error("claim should not run");
    },
    findRun: async () => ({ status: "partial_success", stepRuns: [] }),
    deliver: async () => {
      deliveries += 1;
      return { outcome: "executed", runId: "run", externalCallExecuted: true };
    },
    settle: async (_id, data) => {
      settled.push(data.status);
    },
  });
  assert.equal(deliveries, 0);
  assert.deepEqual(settled, ["settled"]);
  assert.equal(result.delivered, 0);
  assert.equal(result.uncertain, 0);
});

test("processDue delivers a pending row and does not deliver an uncertain or crashed run", async () => {
  const delivered: string[] = [];
  const settled: Array<{ id: string; status: string; lastError: string | null }> = [];
  await processDueGhlAssociationDispatches({
    now,
    listDue: async () => [
      row(),
      row({
        id: "outbox-2",
        status: "executing",
        executingAt: new Date(now.getTime() - 120_000),
        routingDryRunDecisionId: "decision-2",
      }),
      row({
        id: "outbox-3",
        status: "executing",
        executingAt: new Date(now.getTime() - 120_000),
        routingDryRunDecisionId: "decision-3",
      }),
    ],
    claim: async (item) => item.id === "outbox-1",
    findRun: async (decisionId) =>
      decisionId === "decision-2" ? { id: "run-2", status: "executing", stepRuns: [] } : null,
    deliver: async (item) => {
      delivered.push(item.id);
      if (item.id === "outbox-4") throw new Error("transport crashed");
      return { outcome: "executed", runId: "run-1", status: "partial_success", externalCallExecuted: true };
    },
    settle: async (id, data) => {
      settled.push({ id, status: data.status, lastError: data.lastError });
    },
  });
  assert.deepEqual(delivered, ["outbox-1"]);
  assert.deepEqual(settled, [
    { id: "outbox-1", status: "settled", lastError: null },
    { id: "outbox-2", status: "uncertain", lastError: "attempt_in_flight" },
    { id: "outbox-3", status: "uncertain", lastError: "external_outcome_unknown" },
  ]);
});

test("a lost claim and a thrown delivery do not send a second time", async () => {
  const delivered: string[] = [];
  const settled: string[] = [];
  await processDueGhlAssociationDispatches({
    now,
    listDue: async () => [
      row({ id: "lost" }),
      row({ id: "throws" }),
    ],
    claim: async (item) => item.id === "throws",
    findRun: async () => null,
    deliver: async (item) => {
      delivered.push(item.id);
      throw new Error("socket closed");
    },
    settle: async (id) => {
      settled.push(id);
    },
  });
  assert.deepEqual(delivered, ["throws"]);
  assert.deepEqual(settled, []);
});

test("the service flag off records nothing", async () => {
  let writes = 0;
  await recordGhlAssociationDispatchOutbox(
    {
      sourceLeadEventId: "evt-1",
      status: "routing_matched",
      routing: {
        matched: true,
        routingAuthority: "confirmed_source_association",
        destinationClientAccountId: "alex_gross",
        destinationLocationIdGhl: "yCziKRW26eFg8IXAQZ73",
      },
      resolvedAt: now,
    },
    { ghlAssociationDispatchOutbox: { upsert: async () => { writes += 1; } } } as never,
    {}
  );
  assert.equal(writes, 0);
});

test("intake records the outbox inside the commit and claims it before the GHL call", () => {
  const routing = readFileSync(join(import.meta.dirname, "../source-intake/source-intake-routing-persist.ts"), "utf8");
  const sheets = routing.indexOf("await recordCompanySheetsCampaignIntent");
  const outbox = routing.indexOf("await recordGhlAssociationDispatchOutbox");
  const claim = routing.indexOf("await claimPendingAssociationOutbox");
  const deliver = routing.indexOf("await deliverConfirmedAssociationIfActivated");
  assert.ok(sheets > 0 && outbox > sheets && claim > outbox && deliver > claim);
  assert.match(routing.slice(outbox, claim), /\}\);/);
  assert.match(routing, /not guaranteed to finish/);
  assert.match(routing, /stays uncertain/);
  assert.equal(routing.includes("OngoingGhlDispatchIntent"), false);
});
