import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyDirectDemoView,
  directDemoOutcomeLabel,
  displayText,
  normalizeDirectDemoResult,
  stringList,
} from "./normalize-result.ts";

test("stringList drops objects and keeps strings", () => {
  assert.deepEqual(stringList(["a", 1, null, { x: 1 }, " b "]), ["a", "1", "b"]);
  assert.deepEqual(stringList(undefined), []);
  assert.deepEqual(stringList("not-array"), []);
});

test("displayText never returns object coercions that break React", () => {
  assert.equal(displayText(null), "—");
  assert.equal(displayText("hello"), "hello");
  assert.equal(displayText(42), "42");
  assert.ok(displayText({ foo: "bar" }).includes("foo"));
});

test("normalizeDirectDemoResult handles missing readiness.blockers", () => {
  const view = normalizeDirectDemoResult({
    ok: true,
    mode: "simulate",
    matched: true,
    readiness: { canDeliverLive: false },
    warnings: ["warn"],
    blockers: "not-an-array",
  });
  assert.equal(view.ok, true);
  assert.deepEqual(view.readiness?.blockers, []);
  assert.deepEqual(view.blockers, []);
  assert.deepEqual(view.warnings, ["warn"]);
});

test("normalizeDirectDemoResult handles invalid root", () => {
  const view = normalizeDirectDemoResult(null, "live_canary");
  assert.equal(view.ok, false);
  assert.equal(view.mode, "live_canary");
  assert.ok(view.reason?.includes("Unexpected"));
});

test("createEmptyDirectDemoView is render-safe", () => {
  const view = createEmptyDirectDemoView("test");
  assert.deepEqual(view.blockers, []);
  assert.deepEqual(view.warnings, []);
  assert.equal(view.duplicateRisk, null);
});

test("directDemoOutcomeLabel marks live contact failure as failed", () => {
  assert.equal(
    directDemoOutcomeLabel({
      ok: false,
      externalCallExecuted: true,
      liveRunStatus: "failed",
    }),
    "failed"
  );
});

test("normalizeDirectDemoResult renders liveRunFailure safely", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    matched: true,
    externalCallExecuted: true,
    liveRunStatus: "failed",
    reason: "Contact creation failed; downstream steps were skipped.",
    liveRunFailure: {
      failedStepType: "create_or_update_contact",
      failedStepLabel: "Create or update GHL contact",
      httpStatus: 400,
      errorMessage: "customFields must be an array",
      requestBodyKeys: ["locationId", "email"],
      partialContactCreated: false,
    },
    blockers: ["customFields must be an array"],
  });
  assert.equal(view.ok, false);
  assert.equal(view.liveRunFailure?.httpStatus, 400);
  assert.equal(view.liveRunFailure?.errorMessage, "customFields must be an array");
  assert.equal(directDemoOutcomeLabel(view), "failed");
});
