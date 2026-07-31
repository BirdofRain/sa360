import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DependencyTimeoutError,
  createAdminRouteDiagnostics,
  runWithDependencyTimeout,
} from "./admin-route-diagnostics.js";

test("runWithDependencyTimeout returns success without retry", async () => {
  let calls = 0;
  const result = await runWithDependencyTimeout("dep", 1_000, async () => {
    calls += 1;
    return { ok: true };
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { ok: true });
  assert.equal(calls, 1);
});

test("runWithDependencyTimeout times out without unbounded retry", async () => {
  let calls = 0;
  const result = await runWithDependencyTimeout("slow_dep", 30, async (signal) => {
    calls += 1;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 500);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        },
        { once: true }
      );
    });
    return "never";
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "dependency_timeout");
    assert.ok(result.error instanceof DependencyTimeoutError);
  }
  assert.equal(calls, 1);
});

test("runWithDependencyTimeout stops when parent AbortSignal aborts", async () => {
  const parent = new AbortController();
  const pending = runWithDependencyTimeout(
    "parent_abort",
    5_000,
    async (signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true }
        );
      });
      return "never";
    },
    parent.signal
  );
  parent.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.code === "dependency_aborted" || result.code === "dependency_timeout");
  }
});

test("createAdminRouteDiagnostics records heap delta fields", () => {
  const diag = createAdminRouteDiagnostics("/admin/v1/fulfillment-ops/bootstrap", "req_test");
  diag.record({
    dependency: "inventory_summary",
    outcome: "success",
    durationMs: 12,
    rowsRead: 0,
  });
  const finished = diag.finish();
  assert.equal(finished.requestId, "req_test");
  assert.equal(finished.route, "/admin/v1/fulfillment-ops/bootstrap");
  assert.equal(finished.dependencies.length, 1);
  assert.equal(typeof finished.memoryBeforeMb, "number");
  assert.equal(typeof finished.heapDeltaMb, "number");
});
