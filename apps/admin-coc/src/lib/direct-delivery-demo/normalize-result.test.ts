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

test("directDemoOutcomeLabel marks partial_success when contact created but downstream failed", () => {
  assert.equal(
    directDemoOutcomeLabel({
      ok: false,
      externalCallExecuted: true,
      liveRunStatus: "partial_success",
    }),
    "partial_success"
  );
});

test("normalizeDirectDemoResult renders partial success step summary safely", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    matched: true,
    externalCallExecuted: true,
    liveRunStatus: "partial_success",
    contactIdGhl: "AjPwW9LZ8cKiABHbPFpd",
    liveRunStepSummary: [
      {
        stepType: "create_or_update_contact",
        label: "Contact created",
        status: "succeeded",
        externalId: "AjPwW9LZ8cKiABHbPFpd",
      },
      {
        stepType: "stamp_custom_fields",
        label: "Custom fields",
        status: "skipped",
        detail: "GHL_SA360_CUSTOM_FIELD_IDS_JSON is missing or empty",
      },
      {
        stepType: "create_or_update_opportunity",
        label: "Opportunity",
        status: "failed",
        errorMessage: "pipelineStageId is invalid",
        httpStatus: 422,
      },
      {
        stepType: "assign_owner",
        label: "Owner assignment",
        status: "skipped",
        detail: "Owner assignment skipped — no valid GHL user configured.",
      },
      {
        stepType: "start_workflow",
        label: "Workflow",
        status: "skipped",
        detail: "Workflow skipped — opportunity creation did not succeed.",
      },
    ],
    blockers: ["pipelineStageId is invalid"],
  });
  assert.equal(view.ok, false);
  assert.equal(view.contactIdGhl, "AjPwW9LZ8cKiABHbPFpd");
  assert.equal(directDemoOutcomeLabel(view), "partial_success");
  assert.equal(view.liveRunStepSummary.length, 5);
  assert.equal(view.liveRunStepSummary[2]?.errorMessage, "pipelineStageId is invalid");
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
