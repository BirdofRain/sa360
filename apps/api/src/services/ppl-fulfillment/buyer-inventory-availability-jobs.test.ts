import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { BuyerInventoryAvailabilityResult } from "./buyer-inventory-availability.service.js";
import {
  BUYER_AVAILABILITY_JOB_POLL_IDLE_MS,
  cancelBuyerInventoryAvailabilityJob,
  readBuyerInventoryAvailabilityJob,
  resetBuyerInventoryAvailabilityJobsForTests,
  startBuyerInventoryAvailabilityJob,
  sweepBuyerInventoryAvailabilityJobs,
} from "./buyer-inventory-availability-jobs.js";

afterEach(() => {
  resetBuyerInventoryAvailabilityJobsForTests();
});

function exactResult(eligibleTotal = 4): BuyerInventoryAvailabilityResult {
  return {
    ok: true,
    eligibleTotal,
    eligibleCountSemantics: "exact",
    queryCompleteness: "complete",
    buyer: { clientAccountId: "buyer-a", clientDisplayName: "Buyer A" },
  } as BuyerInventoryAvailabilityResult;
}

function deferredLookup() {
  let release: (result: BuyerInventoryAvailabilityResult) => void = () => undefined;
  let progress: ((progress: {
    phase: "classifying";
    pagesRead: number;
    rowsClassified: number;
    selectableRowsExact: number;
  }) => void) | null = null;
  const lookup = (input: {
    signal?: AbortSignal;
    onProgress?: (progress: {
      phase: "classifying";
      pagesRead: number;
      rowsClassified: number;
      selectableRowsExact: number;
    }) => void;
  }) =>
    new Promise<BuyerInventoryAvailabilityResult>((resolve) => {
      progress = input.onProgress ?? null;
      const finish = (result: BuyerInventoryAvailabilityResult) => resolve(result);
      release = finish;
      input.signal?.addEventListener("abort", () => {
        finish({
          ok: false,
          code: "availability_snapshot_unavailable",
          reasons: ["availability_snapshot_unavailable"],
        });
      });
    });
  return {
    lookup,
    release: (result: BuyerInventoryAvailabilityResult) => release(result),
    publish: (rowsClassified: number, selectableRowsExact: number) => {
      progress?.({
        phase: "classifying",
        pagesRead: 1,
        rowsClassified,
        selectableRowsExact,
      });
    },
  };
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("a background count returns a job id before the snapshot finishes", async () => {
  const pending = deferredLookup();
  const started = startBuyerInventoryAvailabilityJob({
    audience: { kind: "admin" },
    request: { clientAccountId: "buyer-a", nicheKey: "trucker", states: ["GA"] },
    lookup: pending.lookup,
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const running = readBuyerInventoryAvailabilityJob(started.jobId, { kind: "admin" });
  assert.equal(running.ok, true);
  if (!running.ok) return;
  assert.equal(running.status, "running");
  assert.equal(running.result, undefined);
  assert.equal(JSON.stringify(running).includes("eligibleTotal"), false);
  assert.equal(running.effects.reservationCreated, false);

  pending.publish(250, 1000);
  const progressed = readBuyerInventoryAvailabilityJob(started.jobId, { kind: "admin" });
  assert.equal(progressed.ok, true);
  if (!progressed.ok) return;
  assert.equal(progressed.progress.rowsClassified, 250);
  assert.equal(progressed.progress.selectableRowsExact, 1000);
  assert.equal(progressed.result, undefined);

  pending.release(exactResult(8));
  await settled();
  const done = readBuyerInventoryAvailabilityJob(started.jobId, { kind: "admin" });
  assert.equal(done.ok, true);
  if (!done.ok) return;
  assert.equal(done.status, "complete");
  assert.equal(done.result?.eligibleTotal, 8);
  assert.equal(done.result?.eligibleCountSemantics, "exact");
});

test("a second count is refused while one snapshot is open", async () => {
  const pending = deferredLookup();
  const first = startBuyerInventoryAvailabilityJob({
    audience: { kind: "admin" },
    request: { clientAccountId: "buyer-a", nicheKey: "trucker" },
    lookup: pending.lookup,
  });
  assert.equal(first.ok, true);
  const second = startBuyerInventoryAvailabilityJob({
    audience: { kind: "portal", clientAccountId: "buyer-b" },
    request: { clientAccountId: "buyer-b", nicheKey: "trucker" },
    lookup: pending.lookup,
  });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.code, "availability_job_busy");
});

test("cancel drops a late success so it is not an exact total", async () => {
  let release: (result: BuyerInventoryAvailabilityResult) => void = () => undefined;
  const lookup = () =>
    new Promise<BuyerInventoryAvailabilityResult>((resolve) => {
      release = resolve;
    });
  const started = startBuyerInventoryAvailabilityJob({
    audience: { kind: "admin" },
    request: { clientAccountId: "buyer-a", nicheKey: "trucker", states: ["GA"] },
    lookup,
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const cancelled = cancelBuyerInventoryAvailabilityJob(started.jobId, { kind: "admin" });
  assert.equal(cancelled.ok, true);
  if (!cancelled.ok) return;
  assert.equal(cancelled.status, "cancelled");
  const busy = startBuyerInventoryAvailabilityJob({
    audience: { kind: "admin" },
    request: { clientAccountId: "buyer-a", nicheKey: "trucker", states: ["GA"] },
    lookup,
  });
  assert.equal(busy.ok, false);
  release(exactResult(99));
  await settled();
  const view = readBuyerInventoryAvailabilityJob(started.jobId, { kind: "admin" });
  assert.equal(view.ok, true);
  if (!view.ok) return;
  assert.equal(view.status, "cancelled");
  assert.equal(view.result, undefined);
  assert.equal(JSON.stringify(view).includes("99"), false);
  assert.equal(JSON.stringify(view).includes("eligibleTotal"), false);

  const next = startBuyerInventoryAvailabilityJob({
    audience: { kind: "admin" },
    request: { clientAccountId: "buyer-a", nicheKey: "trucker", states: ["GA"] },
    lookup: async () => exactResult(1),
  });
  assert.equal(next.ok, true);
});

test("a poll gap cancels the snapshot and does not keep a partial total", async () => {
  const pending = deferredLookup();
  const started = startBuyerInventoryAvailabilityJob({
    audience: { kind: "portal", clientAccountId: "buyer-a" },
    request: { clientAccountId: "buyer-a", nicheKey: "trucker" },
    lookup: pending.lookup,
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  pending.publish(10, 500);
  sweepBuyerInventoryAvailabilityJobs(Date.now() + BUYER_AVAILABILITY_JOB_POLL_IDLE_MS + 1);
  await settled();
  const view = readBuyerInventoryAvailabilityJob(started.jobId, {
    kind: "portal",
    clientAccountId: "buyer-a",
  });
  assert.equal(view.ok, true);
  if (!view.ok) return;
  assert.equal(view.status, "cancelled");
  assert.equal(view.result, undefined);
  assert.equal(JSON.stringify(view).includes("eligibleTotal"), false);
});

test("portal and admin audiences cannot read each other's jobs", () => {
  const started = startBuyerInventoryAvailabilityJob({
    audience: { kind: "portal", clientAccountId: "buyer-a" },
    request: { clientAccountId: "buyer-a", nicheKey: "trucker", states: ["GA"] },
    lookup: async () => exactResult(1),
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(
    readBuyerInventoryAvailabilityJob(started.jobId, { kind: "admin" }).ok,
    false
  );
  assert.equal(
    readBuyerInventoryAvailabilityJob(started.jobId, {
      kind: "portal",
      clientAccountId: "buyer-b",
    }).ok,
    false
  );
  assert.equal(
    readBuyerInventoryAvailabilityJob(started.jobId, {
      kind: "portal",
      clientAccountId: "buyer-a",
    }).ok,
    true
  );
});

test("a failed count is not returned as an exact total", async () => {
  const started = startBuyerInventoryAvailabilityJob({
    audience: { kind: "admin" },
    request: { clientAccountId: "missing", nicheKey: "trucker" },
    lookup: async () => ({
      ok: false,
      code: "buyer_not_found",
      reasons: ["buyer_not_found"],
    }),
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  await settled();
  const view = readBuyerInventoryAvailabilityJob(started.jobId, { kind: "admin" });
  assert.equal(view.ok, true);
  if (!view.ok) return;
  assert.equal(view.status, "failed");
  assert.equal(view.failure?.code, "buyer_not_found");
  assert.equal(view.result, undefined);
});
