import type { DuplicateRiskAssessmentItem } from "./duplicate-risk-types.ts";

export type DuplicateOverrideStatus = "same_person" | "separate_person" | "ignored_test";

export const NO_DUPLICATE_CANDIDATE_MESSAGE =
  "No duplicate candidate is available for this action.";

/**
 * Identity-link overrides ("same person" / "separate person") only make sense when
 * there is at least one duplicate candidate to link/separate against. "Ignored (test)"
 * is a pure operator annotation and never requires a candidate.
 */
export function duplicateOverrideRequiresCandidate(
  status: DuplicateOverrideStatus
): boolean {
  return status === "same_person" || status === "separate_person";
}

/** True when the assessment exposes at least one duplicate candidate match. */
export function hasDuplicateCandidate(
  assessment: DuplicateRiskAssessmentItem | null | undefined
): boolean {
  if (!assessment) return false;
  const candidates = Array.isArray(assessment.candidateMatches)
    ? assessment.candidateMatches
    : [];
  return candidates.length > 0;
}

export type DuplicateOverrideGuardResult = {
  allowed: boolean;
  /** Inline error message to surface when `allowed` is false. */
  message: string | null;
};

/**
 * Authoritative guard shared by the duplicate/identity UI (to disable buttons) and the
 * server action (to validate before mutation). Never throws; returns a structured result.
 */
export function canRunDuplicateOverride(
  assessment: DuplicateRiskAssessmentItem | null | undefined,
  status: DuplicateOverrideStatus
): DuplicateOverrideGuardResult {
  if (!assessment) {
    return {
      allowed: false,
      message: "Duplicate-risk assessment is not available for this decision.",
    };
  }
  if (duplicateOverrideRequiresCandidate(status) && !hasDuplicateCandidate(assessment)) {
    return { allowed: false, message: NO_DUPLICATE_CANDIDATE_MESSAGE };
  }
  return { allowed: true, message: null };
}
