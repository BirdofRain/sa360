import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";

export type ClientAccountStatus = "active" | "paused" | "onboarding" | "archived";

export type ClientGhlDestination = {
  id: string;
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  locationName: string | null;
  ghlConnectionStatus: string | null;
  snapshotInstalled: boolean;
  requiredFieldsInstalled: boolean;
  defaultAssignedUserIdGhl: string | null;
  destinationWorkflowIdGhl: string | null;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
  pipelineStageContactingIdGhl: string | null;
  pipelineStageAppointmentSetIdGhl: string | null;
  pipelineStageShowedIdGhl: string | null;
  pipelineStageSoldIdGhl: string | null;
  pipelineStageDeadIdGhl: string | null;
  opportunityCreationEnabled: boolean;
  backupSheetEnabled: boolean;
  backupSheetId: string | null;
  deliveryMode: string;
  deliveryEnabled: boolean;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
  sourceAttributeFieldMapJson?: unknown;
  sourceEnrichmentPolicyJson?: unknown;
  sourceFieldAliasOverridesJson?: unknown;
  updatedAt: string;
};

export type ClientAccountListItem = {
  clientAccountId: string;
  clientDisplayName: string;
  status: ClientAccountStatus;
  portalEnabled: boolean;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
  hasGhlDestination: boolean;
  destinationSubaccountIdGhl: string | null;
  updatedAt: string;
};

export type DeliveryReadinessAssessment = RoutingRuleWithReadinessItem["readiness"];

export type ClientAccountDetail = {
  clientAccountId: string;
  clientDisplayName: string;
  status: ClientAccountStatus;
  portalEnabled: boolean;
  portalDisplayName: string | null;
  portalLoginEmail: string | null;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  ghlDestination: ClientGhlDestination | null;
  routingRules: RoutingRuleWithReadinessItem[];
  destinationReadiness: DeliveryReadinessAssessment | null;
  activeRoutingRuleCount: number;
};

export type ClientsListResponse = {
  ok: boolean;
  count: number;
  items: ClientAccountListItem[];
};

export type ClientDetailResponse = {
  ok: boolean;
  item: ClientAccountDetail;
};

export type RoutingMatchType =
  | "campaign_id"
  | "adset_id"
  | "ad_id"
  | "form_id_utm_campaign"
  | "utm_campaign"
  | "keyword_fallback";

export type RoutingRuleCreateBody = {
  masterClientAccountId: string;
  clientAccountId: string;
  clientDisplayName?: string | null;
  destinationSubaccountIdGhl?: string;
  locationName?: string | null;
  nicheKey?: string | null;
  productType?: string | null;
  sourcePlatform?: string | null;
  sourceType?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  formId?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  masterDatasetId?: string | null;
  matchType: RoutingMatchType;
  keywordPattern?: string | null;
  priority?: number;
  active?: boolean;
};
