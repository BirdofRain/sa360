export type DuplicateCandidateMatch = {
  matchType: string;
  confidence: string;
  existingLeadUid: string | null;
  existingContactIdGhl: string | null;
  existingEventUuid: string | null;
  existingClientAccountId: string | null;
  existingSubaccountIdGhl: string | null;
  detail: string;
  matchedAt: string | null;
};

export type DuplicateRiskAssessmentItem = {
  id: string;
  masterClientAccountId: string;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  sourceEventUuid: string | null;
  sourceLeadUid: string | null;
  routingDryRunDecisionId: string | null;
  leadDeliveryPlanId: string | null;
  identityStatus: string;
  riskLevel: string;
  confidence: string;
  recommendedAction: string;
  reasons: string[];
  candidateMatches: DuplicateCandidateMatch[];
  blocksLiveDelivery: boolean;
  isWarningOnly: boolean;
  operatorOverrideStatus: string | null;
  operatorNotes: string | null;
  operatorUpdatedAt: string | null;
  operatorUpdatedBy: string | null;
  evaluatedAt: string;
};

export type DuplicateRiskReviewPatchBody = {
  operatorOverrideStatus: "same_person" | "separate_person" | "ignored_test";
  operatorNotes?: string | null;
  operatorUpdatedBy?: string | null;
};
