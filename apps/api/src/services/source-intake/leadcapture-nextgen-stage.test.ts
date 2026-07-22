import test from "node:test";
import assert from "node:assert/strict";
import {
  getLeadCaptureNextGenIntakeStage,
  nextGenStageAtLeast,
  parseLeadCaptureNextGenIntakeStage,
} from "./leadcapture-nextgen-stage.js";

test("parse defaults to capture_only", () => {
  assert.equal(parseLeadCaptureNextGenIntakeStage(undefined), "capture_only");
  assert.equal(parseLeadCaptureNextGenIntakeStage("bogus"), "capture_only");
});

test("stage ranking", () => {
  assert.equal(nextGenStageAtLeast("capture_only", "capture_only"), true);
  assert.equal(nextGenStageAtLeast("capture_only", "normalize_route_proof"), false);
  assert.equal(nextGenStageAtLeast("shadow_fulfillment", "normalize_route_proof"), true);
  assert.equal(nextGenStageAtLeast("live_canary", "shadow_fulfillment"), true);
});

test("env stage reader", () => {
  const prev = process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE;
  process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE = "shadow_fulfillment";
  assert.equal(getLeadCaptureNextGenIntakeStage(), "shadow_fulfillment");
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE = prev;
  else delete process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE;
});
