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
