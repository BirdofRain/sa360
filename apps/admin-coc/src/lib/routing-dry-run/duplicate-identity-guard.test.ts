import test from "node:test";
import assert from "node:assert/strict";

import {
  canRunDuplicateOverride,
  hasDuplicateCandidate,
  NO_DUPLICATE_CANDIDATE_MESSAGE,
} from "./duplicate-identity-guard.ts";
import type { DuplicateRiskAssessmentItem } from "./duplicate-risk-types.ts";

function assessment(
  overrides: Partial<DuplicateRiskAssessmentItem> = {}
): DuplicateRiskAssessmentItem {
  return {
    id: "dup_1",
    masterClientAccountId: "master_1",
    destinationClientAccountId: null,
    destinationSubaccountIdGhl: null,
    sourceEventUuid: null,
    sourceLeadUid: "lead_1",
    routingDryRunDecisionId: "dec_1",
    leadDeliveryPlanId: null,
    identityStatus: "needs_review",
    riskLevel: "none",
    confidence: "low",
    recommendedAction: "No duplicate-risk signals detected.",
    reasons: [],
    candidateMatches: [],
    blocksLiveDelivery: false,
    isWarningOnly: false,
    operatorOverrideStatus: null,
    operatorNotes: null,
    operatorUpdatedAt: null,
    operatorUpdatedBy: null,
    evaluatedAt: "2026-06-29T00:00:00.000Z",
    ...overrides,
  };
}

const candidate: DuplicateRiskAssessmentItem["candidateMatches"][number] = {
  matchType: "phone",
  confidence: "high",
  existingLeadUid: "lead_existing",
  existingContactIdGhl: "ghl_1",
  existingEventUuid: null,
  existingClientAccountId: null,
  existingSubaccountIdGhl: null,
  detail: "Phone match",
  matchedAt: null,
};

test("hasDuplicateCandidate is false for none/empty and true with candidates", () => {
  assert.equal(hasDuplicateCandidate(null), false);
  assert.equal(hasDuplicateCandidate(assessment()), false);
  assert.equal(hasDuplicateCandidate(assessment({ candidateMatches: [candidate] })), true);
});

test("same_person / separate_person are blocked with no candidate and return the inline message", () => {
  for (const status of ["same_person", "separate_person"] as const) {
    const res = canRunDuplicateOverride(assessment(), status);
    assert.equal(res.allowed, false);
    assert.equal(res.message, NO_DUPLICATE_CANDIDATE_MESSAGE);
  }
});

test("ignored_test is always allowed even with no candidate", () => {
  const res = canRunDuplicateOverride(assessment(), "ignored_test");
  assert.equal(res.allowed, true);
  assert.equal(res.message, null);
});

test("same_person is allowed when a candidate exists", () => {
  const res = canRunDuplicateOverride(
    assessment({ candidateMatches: [candidate], riskLevel: "possible_duplicate" }),
    "same_person"
  );
  assert.equal(res.allowed, true);
});

test("null assessment is never allowed for any override", () => {
  assert.equal(canRunDuplicateOverride(null, "same_person").allowed, false);
  assert.equal(canRunDuplicateOverride(null, "ignored_test").allowed, false);
});
