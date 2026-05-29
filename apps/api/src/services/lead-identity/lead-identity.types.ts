export const DUPLICATE_RISK_LEVELS = [
  "none",
  "possible_duplicate",
  "likely_duplicate",
  "source_duplicate",
] as const;

export type DuplicateRiskLevel = (typeof DUPLICATE_RISK_LEVELS)[number];

export const DUPLICATE_CONFIDENCE_LEVELS = ["none", "low", "medium", "high"] as const;

export type DuplicateConfidence = (typeof DUPLICATE_CONFIDENCE_LEVELS)[number];

export const IDENTITY_STATUSES = [
  "linked",
  "needs_review",
  "separate_person",
  "ignored_test",
  "orphan_appointment",
] as const;

export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export const OPERATOR_OVERRIDE_STATUSES = [
  "same_person",
  "separate_person",
  "ignored_test",
] as const;

export type OperatorOverrideStatus = (typeof OPERATOR_OVERRIDE_STATUSES)[number];

export type LeadIdentitySnapshot = {
  sa360LeadUid: string | null;
  masterContactIdGhl: string | null;
  clientContactIdGhl: string | null;
  facebookLeadId: string | null;
  facebookSubmissionId: string | null;
  appointmentId: string | null;
  normalizedPhone: string | null;
  normalizedEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  clientAccountId: string | null;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  campaignId: string | null;
  utmCampaign: string | null;
  nicheKey: string | null;
  sourceType: string | null;
  eventNameInternal: string | null;
  eventReceivedAt: Date | null;
};

export type DuplicateCandidateMatch = {
  matchType:
    | "facebook_lead_id"
    | "facebook_submission_id"
    | "phone"
    | "email"
    | "lead_uid"
    | "contact_id"
    | "name_campaign_proximity"
    | "orphan_appointment";
  confidence: DuplicateConfidence;
  existingLeadUid: string | null;
  existingContactIdGhl: string | null;
  existingEventUuid: string | null;
  existingClientAccountId: string | null;
  existingSubaccountIdGhl: string | null;
  detail: string;
  matchedAt: string | null;
};

export type DuplicateRiskResult = {
  riskLevel: DuplicateRiskLevel;
  confidence: DuplicateConfidence;
  reasons: string[];
  candidateMatches: DuplicateCandidateMatch[];
  recommendedAction: string;
  identityStatus: IdentityStatus;
  blocksLiveDelivery: boolean;
  isWarningOnly: boolean;
};

export type DuplicateRiskAssessmentItem = DuplicateRiskResult & {
  id: string;
  masterClientAccountId: string;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  sourceEventUuid: string | null;
  sourceLeadUid: string | null;
  routingDryRunDecisionId: string | null;
  leadDeliveryPlanId: string | null;
  operatorOverrideStatus: OperatorOverrideStatus | null;
  operatorNotes: string | null;
  operatorUpdatedAt: string | null;
  operatorUpdatedBy: string | null;
  evaluatedAt: string;
  identitySnapshot: LeadIdentitySnapshot;
};
