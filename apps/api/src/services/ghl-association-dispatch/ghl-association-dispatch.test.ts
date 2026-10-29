import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  associationDispatchRecovery,
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

test("a pre-send executing row can be delivered after the lease", () => {
  assert.equal(
    associationDispatchRecovery({
      status: "executing",
      executingAt: new Date(now.getTime() - 120_000),
      run: null,
      now,
    }),
    "deliver"
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

test("processDue delivers a pending row and does not deliver an uncertain run", async () => {
  const delivered: string[] = [];
  const settled: Array<{ id: string; status: string }> = [];
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
    ],
    claim: async () => true,
    findRun: async (decisionId) =>
      decisionId === "decision-2" ? { status: "executing", stepRuns: [] } : null,
    deliver: async (item) => {
      delivered.push(item.id);
      return { outcome: "executed", runId: "run-1", externalCallExecuted: true };
    },
    settle: async (id, data) => {
      settled.push({ id, status: data.status });
    },
  });
  assert.deepEqual(delivered, ["outbox-1"]);
  assert.deepEqual(settled, [
    { id: "outbox-1", status: "settled" },
    { id: "outbox-2", status: "uncertain" },
  ]);
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

test("intake records the outbox inside the commit and calls GHL after it", () => {
  const routing = readFileSync(join(import.meta.dirname, "../source-intake/source-intake-routing-persist.ts"), "utf8");
  const sheets = routing.indexOf("await recordCompanySheetsCampaignIntent");
  const outbox = routing.indexOf("await recordGhlAssociationDispatchOutbox");
  const deliver = routing.indexOf("await deliverConfirmedAssociationIfActivated");
  assert.ok(sheets > 0 && outbox > sheets && deliver > outbox);
  assert.match(routing.slice(outbox, deliver), /\}\);/);
  assert.match(routing, /not guaranteed to finish/);
  assert.equal(routing.includes("OngoingGhlDispatchIntent"), false);
});
