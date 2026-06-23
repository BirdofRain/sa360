import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEW_BLOCKED_SIMULATION_MESSAGE,
  REVIEW_PENDING_NORMALIZATION_MESSAGE,
  resolveReviewSimulationBanner,
} from "./review-step-messaging.ts";
import type { BulkImportBatchState, BulkImportSummary } from "./wizard-steps.ts";

function readyForReviewBatch(
  overrides: Partial<BulkImportBatchState> = {}
): BulkImportBatchState {
  return {
    status: "ready_for_review",
    mappingJson: { first_name: "first_name", phone: "phone" },
    destinationClientAccountId: "client_a",
    destinationLocationIdGhl: "loc_a",
    wizardStepJson: { step: "review", mappingConfirmed: true },
    ...overrides,
  };
}

function readyForReviewSummary(
  overrides: Partial<BulkImportSummary> = {}
): BulkImportSummary {
  return {
    totalRows: 6,
    identityEligible: 6,
    eligibleForSimulation: 0,
    normalizedSourceEvents: 0,
    ...overrides,
  };
}

test("pre-normalization rows pending shows pending normalization message", () => {
  const banner = resolveReviewSimulationBanner(
    readyForReviewBatch(),
    readyForReviewSummary()
  );
  assert.equal(banner?.kind, "pending_normalization");
  assert.equal(banner?.message, REVIEW_PENDING_NORMALIZATION_MESSAGE);
});

test("post-normalization blocked rows show blocker message", () => {
  const banner = resolveReviewSimulationBanner(
    readyForReviewBatch({ status: "ready_for_review" }),
    readyForReviewSummary({
      normalizedSourceEvents: 6,
      blockedIdentity: 6,
      eligibleForSimulation: 0,
    })
  );
  assert.equal(banner?.kind, "blocked");
  assert.equal(banner?.message, REVIEW_BLOCKED_SIMULATION_MESSAGE);
});

test("post-normalization eligible rows allow simulate without banner", () => {
  const banner = resolveReviewSimulationBanner(
    readyForReviewBatch({ status: "ready_for_simulation" }),
    readyForReviewSummary({
      normalizedSourceEvents: 6,
      eligibleForSimulation: 6,
    })
  );
  assert.equal(banner, null);
});
