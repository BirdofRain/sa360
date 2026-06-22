import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDirectDemoResult } from "@/lib/direct-delivery-demo/normalize-result";
import {
  DELIVERY_CONFIG_INCOMPLETE_MESSAGE,
  deliveryConfigIncompleteMessage,
  failedDeliveryStep,
  hasLiveDeliveryDetail,
  isDeliveryConfigIncomplete,
  sa360ContactStepProof,
} from "@/lib/source-intake/delivery-result-display";

test("deliveryConfigIncompleteMessage triggers on missing config fields", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    deliveryPlanStatus: "needs_config",
    missingConfigFields: ["pipelineId", "pipelineStageId"],
  });
  assert.equal(isDeliveryConfigIncomplete(view), true);
  assert.equal(
    deliveryConfigIncompleteMessage(view),
    `${DELIVERY_CONFIG_INCOMPLETE_MESSAGE} (pipelineId, pipelineStageId)`
  );
});

test("deliveryConfigIncompleteMessage triggers on blocked plan status without fields", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    deliveryPlanStatus: "blocked",
  });
  assert.equal(deliveryConfigIncompleteMessage(view), DELIVERY_CONFIG_INCOMPLETE_MESSAGE);
});

test("deliveryConfigIncompleteMessage is null for a healthy plan", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    deliveryPlanStatus: "planned",
    missingConfigFields: [],
  });
  assert.equal(isDeliveryConfigIncomplete(view), false);
  assert.equal(deliveryConfigIncompleteMessage(view), null);
});

test("failedDeliveryStep prefers explicit failure summary", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    liveRunStatus: "failed",
    liveRunFailure: {
      failedStepType: "create_or_update_opportunity",
      failedStepLabel: "Create GHL opportunity",
      errorMessage: "pipelineStageId is invalid",
      httpStatus: 400,
      httpMethod: "POST",
      httpPath: "/opportunities/",
      requestId: "trace_abc123",
      responseBody: { message: "pipelineStageId is invalid" },
    },
    liveRunStepSummary: [
      { stepType: "create_or_update_opportunity", label: "Opportunity", status: "failed" },
    ],
  });
  const step = failedDeliveryStep(view);
  assert.equal(step?.stepType, "create_or_update_opportunity");
  assert.equal(step?.label, "Create GHL opportunity");
  assert.equal(view.liveRunFailure?.requestId, "trace_abc123");
  assert.equal(view.liveRunFailure?.httpPath, "/opportunities/");
  assert.deepEqual(view.liveRunFailure?.responseBody, { message: "pipelineStageId is invalid" });
});

test("failedDeliveryStep falls back to first failed step summary", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    liveRunStatus: "failed",
    liveRunStepSummary: [
      { stepType: "create_or_update_contact", label: "Contact", status: "succeeded" },
      { stepType: "add_tags", label: "Tags", status: "failed" },
    ],
  });
  assert.equal(failedDeliveryStep(view)?.stepType, "add_tags");
});

test("hasLiveDeliveryDetail is false for a plain blocked pre-write result", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    error: "delivery_blocked",
    reason: "blocked",
  });
  assert.equal(hasLiveDeliveryDetail(view), false);
});

test("sa360ContactStepProof proves SA360 contact success only from the executed step", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    liveRunStatus: "failed",
    liveRunStepSummary: [
      {
        stepType: "create_or_update_contact",
        label: "Contact",
        status: "succeeded",
        externalId: "ghl_contact_42",
        externalCallExecuted: true,
        httpStatus: 200,
      },
    ],
  });
  const proof = sa360ContactStepProof(view);
  assert.equal(proof.executed, "yes");
  assert.equal(proof.externalId, "ghl_contact_42");
  assert.equal(proof.externalCallExecuted, true);
  assert.equal(proof.status, "succeeded");
});

test("sa360ContactStepProof is 'unknown' when the contact step is absent (no SA360 proof)", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    liveRunStatus: "failed",
    // Only the opportunity failure is present — contact step not proven by SA360.
    liveRunFailure: {
      failedStepType: "create_or_update_opportunity",
      failedStepLabel: "Create GHL opportunity",
      errorMessage: "pipelineStageId is invalid",
      httpStatus: 400,
    },
    liveRunStepSummary: [],
  });
  const proof = sa360ContactStepProof(view);
  assert.equal(proof.executed, "unknown");
  assert.equal(proof.externalId, null);
  assert.equal(proof.externalCallExecuted, false);
});

test("sa360ContactStepProof is 'no' when SA360 attempted contact but GHL did not confirm", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    liveRunStatus: "failed",
    liveRunStepSummary: [
      {
        stepType: "create_or_update_contact",
        label: "Contact",
        status: "failed",
        externalCallExecuted: true,
        httpStatus: 400,
      },
    ],
  });
  assert.equal(sa360ContactStepProof(view).executed, "no");
});

test("hasLiveDeliveryDetail is true once an external write was attempted", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    externalCallExecuted: true,
    liveRunStatus: "failed",
  });
  assert.equal(hasLiveDeliveryDetail(view), true);
});
