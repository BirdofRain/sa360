import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldShowInternalCanaryReviewAction,
} from "./approve-preflight-actions.js";

test("internal canary approval action is visible outside diagnostics when eligible", () => {
  assert.equal(
    shouldShowInternalCanaryReviewAction({
      internalApprovalSatisfied: false,
      effectiveRuntimeMode: "live_canary",
      liveCanaryClientMatch: true,
      waveSize: 1,
      maxWaveSize: 1,
    }),
    true
  );
});

test("internal canary approval action hidden when already approved", () => {
  assert.equal(
    shouldShowInternalCanaryReviewAction({
      internalApprovalSatisfied: true,
      effectiveRuntimeMode: "live_canary",
      liveCanaryClientMatch: true,
      waveSize: 1,
      maxWaveSize: 1,
    }),
    false
  );
});
