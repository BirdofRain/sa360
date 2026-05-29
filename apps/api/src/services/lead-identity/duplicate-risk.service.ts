import type {
  DuplicateCandidateMatch,
  DuplicateConfidence,
  DuplicateRiskLevel,
  DuplicateRiskResult,
  IdentityStatus,
  LeadIdentitySnapshot,
} from "./lead-identity.types.js";
import { namesSimilar, normalizeEmail } from "./lead-identity-extract.js";

export type DuplicateRiskLookupRow = {
  leadUid: string | null;
  contactIdGhl: string | null;
  phoneE164: string | null;
  email: string | null;
  displayName: string | null;
  clientAccountId: string;
  subaccountIdGhl: string;
  lastSeenAt: Date | null;
  sourceEventUuid?: string | null;
  facebookLeadId?: string | null;
  facebookSubmissionId?: string | null;
  eventNameInternal?: string | null;
  receivedAt?: Date | null;
};

export type DuplicateRiskEvaluationInput = {
  identity: LeadIdentitySnapshot;
  excludeLeadUid?: string | null;
  excludeEventUuid?: string | null;
  strictPossibleDuplicate?: boolean;
  priorLeadCreatedFound?: boolean;
  lookup: {
    byFacebookLeadId: (id: string) => Promise<DuplicateRiskLookupRow[]>;
    byFacebookSubmissionId: (id: string) => Promise<DuplicateRiskLookupRow[]>;
    byPhone: (phone: string, clientAccountId: string, subaccountIdGhl: string) => Promise<DuplicateRiskLookupRow | null>;
    byEmail: (email: string, clientAccountId: string, subaccountIdGhl: string) => Promise<DuplicateRiskLookupRow | null>;
    byLeadUid: (leadUid: string, clientAccountId: string) => Promise<DuplicateRiskLookupRow | null>;
    byNameCampaignProximity: (
      identity: LeadIdentitySnapshot,
      windowMs: number
    ) => Promise<DuplicateRiskLookupRow[]>;
  };
};

const APPOINTMENT_EVENTS = new Set([
  "appointment_set",
  "appointment_confirmed",
  "appointment_showed",
  "appointment_no_show",
  "appointment_cancelled",
  "appointment_rescheduled",
]);

const CLOSE_TIMESTAMP_MS = 7 * 24 * 60 * 60 * 1000;

function rowToMatch(
  matchType: DuplicateCandidateMatch["matchType"],
  row: DuplicateRiskLookupRow,
  confidence: DuplicateConfidence,
  detail: string
): DuplicateCandidateMatch {
  return {
    matchType,
    confidence,
    existingLeadUid: row.leadUid,
    existingContactIdGhl: row.contactIdGhl,
    existingEventUuid: row.sourceEventUuid ?? null,
    existingClientAccountId: row.clientAccountId,
    existingSubaccountIdGhl: row.subaccountIdGhl,
    detail,
    matchedAt: (row.lastSeenAt ?? row.receivedAt)?.toISOString() ?? null,
  };
}

function isExcluded(row: DuplicateRiskLookupRow, input: DuplicateRiskEvaluationInput): boolean {
  if (input.excludeLeadUid && row.leadUid === input.excludeLeadUid) return true;
  if (input.excludeEventUuid && row.sourceEventUuid === input.excludeEventUuid) return true;
  return false;
}

function deriveRecommendedAction(
  riskLevel: DuplicateRiskLevel,
  identityStatus: IdentityStatus
): string {
  if (identityStatus === "orphan_appointment") {
    return "Review orphan appointment — link to master lead_created or mark as separate person before live delivery.";
  }
  switch (riskLevel) {
    case "source_duplicate":
      return "Do not deliver live — Meta/Facebook lead id already seen. Confirm with operator review.";
    case "likely_duplicate":
      return "Do not deliver live — matching phone or email exists in destination. Review before contact upsert.";
    case "possible_duplicate":
      return "Review candidate matches — similar identity signals but different phone/email. Do not auto-merge.";
    default:
      return "No duplicate risk detected — safe to continue shadow delivery review.";
  }
}

function finalizeResult(
  riskLevel: DuplicateRiskLevel,
  confidence: DuplicateConfidence,
  reasons: string[],
  candidateMatches: DuplicateCandidateMatch[],
  identityStatus: IdentityStatus,
  strictPossibleDuplicate: boolean
): DuplicateRiskResult {
  const blocksLiveDelivery =
    riskLevel === "likely_duplicate" ||
    riskLevel === "source_duplicate" ||
    (strictPossibleDuplicate && riskLevel === "possible_duplicate") ||
    identityStatus === "orphan_appointment";

  const isWarningOnly =
    riskLevel === "possible_duplicate" && !strictPossibleDuplicate && identityStatus !== "orphan_appointment";

  return {
    riskLevel,
    confidence,
    reasons,
    candidateMatches,
    recommendedAction: deriveRecommendedAction(riskLevel, identityStatus),
    identityStatus,
    blocksLiveDelivery,
    isWarningOnly,
  };
}

export async function evaluateDuplicateRisk(
  input: DuplicateRiskEvaluationInput
): Promise<DuplicateRiskResult> {
  const { identity } = input;
  const reasons: string[] = [];
  const candidateMatches: DuplicateCandidateMatch[] = [];
  const destClient = identity.destinationClientAccountId ?? identity.clientAccountId;
  const destSub = identity.destinationSubaccountIdGhl ?? "";

  if (!destClient) {
    return finalizeResult(
      "none",
      "none",
      ["No destination client account available for duplicate lookup."],
      [],
      "needs_review",
      input.strictPossibleDuplicate === true
    );
  }

  if (identity.facebookLeadId) {
    const rows = await input.lookup.byFacebookLeadId(identity.facebookLeadId);
    for (const row of rows) {
      if (isExcluded(row, input)) continue;
      candidateMatches.push(
        rowToMatch(
          "facebook_lead_id",
          row,
          "high",
          `Facebook lead id ${identity.facebookLeadId} already recorded for another lead.`
        )
      );
    }
    if (candidateMatches.some((m) => m.matchType === "facebook_lead_id")) {
      reasons.push("Exact facebookLeadId match found in SA360 assessments.");
      return finalizeResult(
        "source_duplicate",
        "high",
        reasons,
        candidateMatches,
        "needs_review",
        input.strictPossibleDuplicate === true
      );
    }
  }

  if (identity.facebookSubmissionId) {
    const rows = await input.lookup.byFacebookSubmissionId(identity.facebookSubmissionId);
    for (const row of rows) {
      if (isExcluded(row, input)) continue;
      candidateMatches.push(
        rowToMatch(
          "facebook_submission_id",
          row,
          "high",
          `Facebook submission id ${identity.facebookSubmissionId} already recorded.`
        )
      );
    }
    if (candidateMatches.some((m) => m.matchType === "facebook_submission_id")) {
      reasons.push("Exact facebookSubmissionId match found in SA360 assessments.");
      return finalizeResult(
        "source_duplicate",
        "high",
        reasons,
        candidateMatches,
        "needs_review",
        input.strictPossibleDuplicate === true
      );
    }
  }

  if (identity.normalizedPhone) {
    const row = await input.lookup.byPhone(identity.normalizedPhone, destClient, destSub);
    if (row && !isExcluded(row, input) && row.leadUid !== identity.sa360LeadUid) {
      candidateMatches.push(
        rowToMatch(
          "phone",
          row,
          "high",
          `Phone ${identity.normalizedPhone} already indexed for destination.`
        )
      );
      reasons.push("Exact normalized phone match in destination subaccount.");
      return finalizeResult(
        "likely_duplicate",
        "high",
        reasons,
        candidateMatches,
        "needs_review",
        input.strictPossibleDuplicate === true
      );
    }
  }

  const email = normalizeEmail(identity.normalizedEmail);
  if (email) {
    const row = await input.lookup.byEmail(email, destClient, destSub);
    if (row && !isExcluded(row, input) && row.leadUid !== identity.sa360LeadUid) {
      candidateMatches.push(
        rowToMatch(
          "email",
          row,
          "high",
          `Email ${email} already indexed for destination.`
        )
      );
      reasons.push("Exact normalized email match in destination subaccount.");
      return finalizeResult(
        "likely_duplicate",
        "high",
        reasons,
        candidateMatches,
        "needs_review",
        input.strictPossibleDuplicate === true
      );
    }
  }

  const isAppointmentEvent =
    identity.eventNameInternal != null && APPOINTMENT_EVENTS.has(identity.eventNameInternal);

  if (isAppointmentEvent && input.priorLeadCreatedFound === false) {
    reasons.push(
      "Appointment event received without a matched upstream lead_created for this identity."
    );
    const proximity = await input.lookup.byNameCampaignProximity(identity, CLOSE_TIMESTAMP_MS);
    for (const row of proximity) {
      if (isExcluded(row, input)) continue;
      candidateMatches.push(
        rowToMatch(
          "orphan_appointment",
          row,
          "medium",
          "Possible related lead/contact found for orphan appointment linking."
        )
      );
    }
    return finalizeResult(
      candidateMatches.length > 0 ? "possible_duplicate" : "none",
      candidateMatches.length > 0 ? "medium" : "low",
      reasons,
      candidateMatches,
      "orphan_appointment",
      input.strictPossibleDuplicate === true
    );
  }

  const proximityRows = await input.lookup.byNameCampaignProximity(identity, CLOSE_TIMESTAMP_MS);
  for (const row of proximityRows) {
    if (isExcluded(row, input)) continue;
    const samePhone =
      identity.normalizedPhone &&
      row.phoneE164 &&
      identity.normalizedPhone === row.phoneE164;
    const sameEmail =
      email && row.email && normalizeEmail(row.email) === email;
    if (samePhone || sameEmail) continue;

    const nameMatch = namesSimilar(identity.fullName, row.displayName);
    if (!nameMatch) continue;

    candidateMatches.push(
      rowToMatch(
        "name_campaign_proximity",
        row,
        "medium",
        "Similar name in same destination/campaign window with different phone/email — review only, no auto-merge."
      )
    );
    reasons.push(
      "Similar name + same destination/campaign context within 7 days but different contact identifiers."
    );
  }

  if (candidateMatches.length > 0) {
    return finalizeResult(
      "possible_duplicate",
      "medium",
      reasons,
      candidateMatches,
      "needs_review",
      input.strictPossibleDuplicate === true
    );
  }

  return finalizeResult(
    "none",
    "none",
    ["No duplicate-risk signals detected."],
    [],
    "linked",
    input.strictPossibleDuplicate === true
  );
}

export function applyOperatorOverrideToLiveBlock(
  result: Pick<DuplicateRiskResult, "riskLevel" | "blocksLiveDelivery">,
  operatorOverrideStatus: string | null | undefined
): boolean {
  if (operatorOverrideStatus === "separate_person" || operatorOverrideStatus === "ignored_test") {
    return false;
  }
  if (operatorOverrideStatus === "same_person") {
    return result.riskLevel === "likely_duplicate" || result.riskLevel === "source_duplicate";
  }
  return result.blocksLiveDelivery;
}
