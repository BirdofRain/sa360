import type { DeliveryReadinessAssessment } from "@/lib/delivery-readiness/types";
import type { DuplicateRiskAssessmentItem } from "./duplicate-risk-types";
import type { LeadDeliveryPlanItem, LeadDeliveryPlanSummary } from "./delivery-plan-types";

export type { LeadDeliveryPlanItem, LeadDeliveryPlanSummary };

/** Wire shapes from `GET /admin/v1/routing/dry-run-decisions` and `POST /admin/v1/routing/dry-run`. */

export type RoutingDryRunMatchedRuleSummary = {
  id: string;
  clientDisplayName: string | null;
  clientAccountId: string;
  nicheKey: string | null;
  productType: string | null;
  matchType: string;
};

export type RoutingDryRunLeadIdentity = {
  contactIdGhl: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  phoneE164: string | null;
  email: string | null;
};

export type RoutingAttributionSnapshot = {
  masterClientAccountId?: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adId?: string;
  formId?: string;
  utmCampaign?: string;
  utmContent?: string;
  sourcePlatform?: string;
  sourceType?: string;
  nicheKey?: string;
  productType?: string;
  masterDatasetId?: string;
};

export type RoutingValidationSuggestion = {
  suggestedValidationStatus: string;
  suggestedValidationReason: string;
  suggestionConfidence: "high" | "medium" | "low";
};

export type LegacyPrefillSuggestion = {
  legacyDeliveredClientAccountId: string | null;
  legacyDeliveredSubaccountIdGhl: string | null;
  legacyDeliveryContactIdGhl: string | null;
  legacyDeliveryStatus: string | null;
  prefillReason: string | null;
  prefillConfidence: "high" | "medium" | "low" | null;
};

export type RoutingDryRunStats = {
  masterClientAccountId: string;
  destinationClientAccountId: string | null;
  createdAfter: string | null;
  createdBefore: string | null;
  totalDecisions: number;
  matched: number;
  reviewRequired: number;
  generatedPlans: number;
  needsConfigPlans: number;
  validatedMatchedLegacy: number;
  mismatches: number;
  needsMapping: number;
  ignoredTest: number;
  legacyUnknown: number;
  unreviewed: number;
  matchRate: number | null;
  validationCoverage: number | null;
};

export type RoutingDryRunStatsResponse = {
  ok: boolean;
  stats: RoutingDryRunStats;
};

export type RoutingDryRunReviewQueue =
  | "unreviewed_only"
  | "mismatches"
  | "needs_mapping"
  | "matched_no_plan"
  | "matched_needs_config_plan";

export type RoutingDryRunValidationFields = {
  legacyDeliveredClientAccountId: string | null;
  legacyDeliveredSubaccountIdGhl: string | null;
  legacyDeliveryContactIdGhl: string | null;
  legacyDeliveryStatus: string | null;
  validationStatus: string | null;
  validationNotes: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
};

export type RoutingDryRunDecisionItem = {
  id: string;
  createdAt: string;
  sourceEventUuid: string | null;
  sourceLeadUid: string;
  matched: boolean;
  confidence: string;
  matchType: string | null;
  matchedRuleId: string | null;
  matchedRuleSummary: RoutingDryRunMatchedRuleSummary | null;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  reason: string;
  deliveryMode: string;
  routingEventNameInternal: string;
  attributionSnapshot: unknown;
  lifecycleEventsEmitted: string[];
  leadIdentity: RoutingDryRunLeadIdentity | null;
  masterClientAccountId: string;
  deliveryPlanSummary: LeadDeliveryPlanSummary | null;
  suggestedValidation: RoutingValidationSuggestion;
  suggestedLegacyPrefill: LegacyPrefillSuggestion;
  deliveryReadiness: DeliveryReadinessAssessment | null;
  duplicateRisk: DuplicateRiskAssessmentItem | null;
} & RoutingDryRunValidationFields;

export type RoutingDryRunValidationPatchBody = {
  validationStatus: string;
  legacyDeliveredClientAccountId?: string | null;
  legacyDeliveredSubaccountIdGhl?: string | null;
  legacyDeliveryContactIdGhl?: string | null;
  legacyDeliveryStatus?: string | null;
  validationNotes?: string | null;
  validatedBy?: string;
};

export type RoutingDryRunValidationPatchResponse = {
  ok: boolean;
  item: RoutingDryRunDecisionItem;
};

export type RoutingDryRunListResponse = {
  ok: boolean;
  masterClientAccountId: string;
  count: number;
  items: RoutingDryRunDecisionItem[];
};

export type RoutingDryRunTestResult = {
  matched: boolean;
  confidence: string;
  matchType?: string;
  matchedRuleId?: string;
  destinationClientAccountId?: string;
  destinationSubaccountIdGhl?: string;
  reason: string;
  deliveryMode: string;
  routingEventNameInternal: string;
  decisionId: string;
  lifecycleEventsEmitted: string[];
  deliveryPlan?: LeadDeliveryPlanItem | null;
};

export type RoutingDryRunTestResponse = {
  ok: boolean;
  result: RoutingDryRunTestResult;
};
