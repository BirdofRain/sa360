import test from "node:test";
import assert from "node:assert/strict";
import {
  isCandidateMarkableNow,
  parseArgs,
  toUpdateGroups,
  type Candidate,
  type Options,
} from "./audit-incomplete-leads.js";

function candidate(
  action: Candidate["action"],
  overrides: Partial<Candidate> = {}
): Candidate {
  return {
    model: "SourceLeadEvent",
    id: "sle_1",
    action,
    status:
      action === "mark"
        ? "INCOMPLETE_MISSING_CLIENT_AND_NAME"
        : "REVIEW_REQUIRED_INCOMPLETE_IDENTITY",
    reason:
      action === "mark"
        ? "missing_client_first_last"
        : "ambiguous_partial_identity_review_required",
    snapshot: {
      clientAccountId: null,
      clientName: null,
      firstName: null,
      lastName: null,
      fullName: null,
      phone: null,
      email: null,
      leadUid: null,
      contactIdGhl: null,
      subaccountIdGhl: null,
      orderId: null,
      routingRuleId: null,
      deliveryAttemptId: null,
    },
    existingCleanupStatus: null,
    existingCleanupReason: null,
    ...overrides,
  };
}

function opts(overrides: Partial<Options> = {}): Options {
  return {
    mark: false,
    markReviewRequired: false,
    sampleSize: 5,
    batchSize: 500,
    ...overrides,
  };
}

test("parseArgs enables mark-review-required with mark", () => {
  const parsed = parseArgs(["--mark", "--mark-review-required"]);
  assert.equal(parsed.mark, true);
  assert.equal(parsed.markReviewRequired, true);
});

test("dry-run never marks review_required rows", () => {
  const review = candidate("review_required");
  const dryRun = opts({ mark: false, markReviewRequired: true });
  assert.equal(isCandidateMarkableNow(review, dryRun), false);
  assert.deepEqual(toUpdateGroups([review], dryRun), []);
});

test("--mark without --mark-review-required does not mark review_required", () => {
  const review = candidate("review_required");
  const markOnly = opts({ mark: true, markReviewRequired: false });
  assert.equal(isCandidateMarkableNow(review, markOnly), false);
  assert.deepEqual(toUpdateGroups([review], markOnly), []);
});

test("--mark --mark-review-required marks review_required rows", () => {
  const review = candidate("review_required");
  const markWithReview = opts({ mark: true, markReviewRequired: true });
  assert.equal(isCandidateMarkableNow(review, markWithReview), true);
  const groups = toUpdateGroups([review], markWithReview);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.model, "SourceLeadEvent");
  assert.equal(groups[0]?.status, "REVIEW_REQUIRED_INCOMPLETE_IDENTITY");
  assert.equal(groups[0]?.reason, "ambiguous_partial_identity_review_required");
  assert.deepEqual(groups[0]?.ids, ["sle_1"]);
});

test("existing cleanup status is never re-marked", () => {
  const review = candidate("review_required", {
    existingCleanupStatus: "REVIEW_REQUIRED_INCOMPLETE_IDENTITY",
  });
  const markWithReview = opts({ mark: true, markReviewRequired: true });
  assert.equal(isCandidateMarkableNow(review, markWithReview), false);
  assert.deepEqual(toUpdateGroups([review], markWithReview), []);
});
