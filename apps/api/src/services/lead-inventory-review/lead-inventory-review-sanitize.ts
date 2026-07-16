import { REVIEW_OPERATOR_NOTE_MAX_CHARS } from "./lead-inventory-review.constants.js";

/** Sanitize optional operator note: length-bound, strip control chars, never store raw payloads. */
export function sanitizeReviewOperatorNote(note: string | null | undefined): string | null {
  if (note == null) return null;
  const cleaned = note
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, REVIEW_OPERATOR_NOTE_MAX_CHARS);
}

export function presentSafeEligibilitySnapshot(result: {
  eligible: boolean;
  blockerCodes: string[];
  warnings: string[];
  currentStatus: string;
  ageDays: number | null;
  ageBandKey: string | null;
  sourceLane: string | null;
  sourceProvider: string | null;
  normalizedState: string | null;
  proofStatus: string;
  verificationStatus: string;
  duplicateStatus: string;
  provenance: Record<string, boolean>;
  duplicateSummary: { status: string; safe: boolean };
  identitySummary: { present: boolean; hasPhoneOrEmail: boolean; verificationPassed: boolean };
  allocationConflict: boolean;
  deliveryHistoryPresent: boolean;
}) {
  return {
    eligible: result.eligible,
    blockerCodes: result.blockerCodes,
    warnings: result.warnings,
    currentStatus: result.currentStatus,
    ageDays: result.ageDays,
    ageBandKey: result.ageBandKey,
    sourceLane: result.sourceLane,
    sourceProvider: result.sourceProvider,
    normalizedState: result.normalizedState,
    proofStatus: result.proofStatus,
    verificationStatus: result.verificationStatus,
    duplicateStatus: result.duplicateStatus,
    provenance: result.provenance,
    duplicateSummary: result.duplicateSummary,
    identitySummary: {
      present: result.identitySummary.present,
      hasPhoneOrEmail: result.identitySummary.hasPhoneOrEmail,
      verificationPassed: result.identitySummary.verificationPassed,
    },
    allocationConflict: result.allocationConflict,
    deliveryHistoryPresent: result.deliveryHistoryPresent,
  };
}
