import test from "node:test";
import assert from "node:assert/strict";

import type { LiveCanaryExecutionResult } from "../ghl-delivery-adapter/ghl-live-canary-executor.service.js";
import {
  classifyGhlLiveExecutionResult,
  classifyThrownGhlExecutionError,
} from "./ghl-outcome-classifier.service.js";

function makeExecution(
  overrides: Partial<LiveCanaryExecutionResult> & {
    stepOutcomes?: LiveCanaryExecutionResult["stepOutcomes"];
  }
): LiveCanaryExecutionResult {
  return {
    runStatus: "failed",
    summary: "test",
    contactIdGhl: null,
    opportunityIdGhl: null,
    workflowStarted: false,
    errors: [],
    warnings: [],
    stepOutcomes: [],
    ...overrides,
  };
}

function step(
  partial: Partial<LiveCanaryExecutionResult["stepOutcomes"][number]> &
    Pick<LiveCanaryExecutionResult["stepOutcomes"][number], "stepType" | "status">
) {
  return {
    stepOrder: 1,
    deliveryPlanStepId: null,
    targetSystem: "ghl",
    targetId: null,
    externalId: null,
    errorCode: null,
    errorSummary: null,
    warnings: [],
    requestRedactedJson: null,
    responseRedactedJson: null,
    startedAt: new Date(),
    completedAt: new Date(),
    externalCallExecuted: false,
    ...partial,
  };
}

test("pre-send validation failure is terminal without external call", () => {
  const result = classifyGhlLiveExecutionResult(
    makeExecution({
      runStatus: "failed",
      summary: "validation failed",
      stepOutcomes: [],
    }),
    { opportunityConfigured: false }
  );
  assert.equal(result.status, "terminal_pre_send_failure");
});

test("timeout after external call started is unknown outcome", () => {
  const thrown = classifyThrownGhlExecutionError(new Error("timeout"), {
    externalCallMayHaveStarted: true,
  });
  assert.equal(thrown.status, "unknown_outcome");
  assert.equal(thrown.externalCallExecuted, true);
});

test("contact created and opportunity failed requires review", () => {
  const result = classifyGhlLiveExecutionResult(
    makeExecution({
      runStatus: "partial_success",
      contactIdGhl: "contact_1",
      stepOutcomes: [
        step({
          stepType: "create_or_update_contact",
          status: "succeeded",
          externalCallExecuted: true,
          externalId: "contact_1",
        }),
        step({
          stepType: "create_or_update_opportunity",
          status: "failed",
          externalCallExecuted: true,
        }),
      ],
    }),
    { opportunityConfigured: true }
  );
  assert.equal(result.status, "partial_external_success_requiring_review");
});

test("contact and required steps succeeded commits as succeeded", () => {
  const result = classifyGhlLiveExecutionResult(
    makeExecution({
      runStatus: "succeeded",
      contactIdGhl: "contact_1",
      opportunityIdGhl: "opp_1",
      stepOutcomes: [
        step({
          stepType: "create_or_update_contact",
          status: "succeeded",
          externalCallExecuted: true,
          externalId: "contact_1",
        }),
        step({
          stepType: "create_or_update_opportunity",
          status: "succeeded",
          externalCallExecuted: true,
          externalId: "opp_1",
        }),
      ],
    }),
    { opportunityConfigured: true }
  );
  assert.equal(result.status, "succeeded");
});

test("workflow optional failure still succeeds when required path complete", () => {
  const result = classifyGhlLiveExecutionResult(
    makeExecution({
      runStatus: "partial_success",
      contactIdGhl: "contact_1",
      opportunityIdGhl: "opp_1",
      stepOutcomes: [
        step({
          stepType: "create_or_update_contact",
          status: "succeeded",
          externalCallExecuted: true,
          externalId: "contact_1",
        }),
        step({
          stepType: "add_tags",
          status: "succeeded",
          externalCallExecuted: true,
        }),
        step({
          stepType: "create_or_update_opportunity",
          status: "succeeded",
          externalCallExecuted: true,
          externalId: "opp_1",
        }),
        step({
          stepType: "start_workflow",
          status: "optional_failed",
          externalCallExecuted: true,
        }),
      ],
    }),
    { opportunityConfigured: true }
  );
  assert.equal(result.status, "succeeded");
});

test("thrown executor exception before any call is terminal pre-send", () => {
  const thrown = classifyThrownGhlExecutionError(new Error("builder failed"), {
    externalCallMayHaveStarted: false,
  });
  assert.equal(thrown.status, "terminal_pre_send_failure");
});

test("thrown executor exception after one external step is unknown outcome", () => {
  const thrown = classifyThrownGhlExecutionError(new Error("connection reset"), {
    externalCallMayHaveStarted: true,
  });
  assert.equal(thrown.status, "unknown_outcome");
});

test("contact upsert failed after external call is terminal pre-send when contact missing", () => {
  const result = classifyGhlLiveExecutionResult(
    makeExecution({
      runStatus: "failed",
      summary: "contact failed",
      stepOutcomes: [
        step({
          stepType: "create_or_update_contact",
          status: "failed",
          externalCallExecuted: true,
        }),
      ],
    }),
    { opportunityConfigured: false }
  );
  assert.equal(result.status, "terminal_pre_send_failure");
  assert.equal(result.errorCode, "contact_upsert_failed");
});
