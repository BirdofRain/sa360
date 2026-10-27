import assert from "node:assert/strict";
import test from "node:test";

import { onboardingCapturedTestSheetsOutcome } from "./onboarding-captured-test-append.js";

test("a new append keeps the writer external-call flag", () => {
  const outcome = onboardingCapturedTestSheetsOutcome({
    ok: true,
    status: "succeeded",
    rowsWritten: 1,
    appended: true,
    jobId: "job_new",
    externalCallExecuted: true,
  });
  assert.deepEqual(outcome, { status: "succeeded", rowsWritten: 1, externalCallExecuted: true });
});

test("an existing stable row is delivery evidence without a current external call", () => {
  const outcome = onboardingCapturedTestSheetsOutcome({
    ok: true,
    status: "succeeded",
    rowsWritten: 1,
    appended: false,
    jobId: "job_existing",
    externalCallExecuted: false,
  });
  assert.deepEqual(outcome, { status: "succeeded", rowsWritten: 1, externalCallExecuted: false });
});

test("a refused preflight does not become an external call", () => {
  const outcome = onboardingCapturedTestSheetsOutcome({
    ok: false,
    code: "header_mismatch",
    statusCode: 409,
    externalCallExecuted: false,
  });
  assert.deepEqual(outcome, { status: "failed", externalCallExecuted: false, error: "header_mismatch" });
});

test("a timeout after the append starts stays uncertain and keeps its timestamp", () => {
  const outcome = onboardingCapturedTestSheetsOutcome({
    ok: false,
    code: "uncertain",
    statusCode: 409,
    externalCallExecuted: true,
    uncertainReason: "timeout",
    appendStartedAt: "2026-10-27T18:00:00.000Z",
    jobId: "job_timeout",
  });
  assert.deepEqual(outcome, {
    status: "uncertain",
    externalCallExecuted: true,
    reason: "timeout",
    appendStartedAt: "2026-10-27T18:00:00.000Z",
  });
});

test("an unknown append outcome stays uncertain", () => {
  const outcome = onboardingCapturedTestSheetsOutcome({
    ok: false,
    code: "uncertain",
    statusCode: 409,
    externalCallExecuted: true,
    uncertainReason: "unknown",
    appendStartedAt: "2026-10-27T18:05:00.000Z",
    jobId: "job_unknown",
  });
  assert.equal(outcome.status, "uncertain");
  if (outcome.status !== "uncertain") return;
  assert.equal(outcome.externalCallExecuted, true);
  assert.equal(outcome.reason, "unknown");
  assert.equal(outcome.appendStartedAt, "2026-10-27T18:05:00.000Z");
});
