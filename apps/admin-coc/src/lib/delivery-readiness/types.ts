export type OnboardingChecklistItem = {
  key: string;
  label: string;
  complete: boolean;
  detail?: string;
};

export type Sa360FieldMappingReadiness = {
  source: string;
  coreRequiredMapped: string[];
  coreRequiredMissing: string[];
  optionalMapped: string[];
  optionalMissing: string[];
  customFieldStampRequired: boolean;
  coreRequiredComplete: boolean;
  optionMapJson?: Record<string, Record<string, string>>;
  optionMappingWarnings?: string[];
};

export type DeliveryReadinessAssessment = {
  ruleId: string | null;
  clientAccountId: string;
  destinationSubaccountIdGhl: string | null;
  clientDisplayName: string | null;
  readyForShadow: boolean;
  readyForDirectCanary: boolean;
  readyForLive: boolean;
  canDeliverLive: boolean;
  readinessStatus: string;
  blockers: string[];
  warnings: string[];
  missingConfig: string[];
  requiredApprovals: string[];
  recommendedNextAction: string;
  checklist: OnboardingChecklistItem[];
  fieldMapping?: Sa360FieldMappingReadiness;
};

export type RoutingRuleWithReadinessItem = {
  id: string;
  masterClientAccountId: string;
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  clientDisplayName: string | null;
  locationName: string | null;
  nicheKey: string | null;
  productType: string | null;
  campaignId: string | null;
  campaignName: string | null;
  utmCampaign: string | null;
  matchType: string;
  active: boolean;
  priority: number;
  deliveryMode: string;
  deliveryEnabled: boolean;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
  readinessStatus: string;
  lastReadinessCheckAt: string | null;
  ghlConnectionStatus: string | null;
  snapshotInstalled: boolean;
  requiredFieldsInstalled: boolean;
  destinationWorkflowIdGhl: string | null;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
  backupSheetEnabled: boolean;
  backupSheetId: string | null;
  defaultAssignedUserIdGhl: string | null;
  opportunityCreationEnabled: boolean;
  readiness: DeliveryReadinessAssessment;
};

export type DeliveryReadinessListResponse = {
  ok: boolean;
  count: number;
  items: RoutingRuleWithReadinessItem[];
};

export type RoutingRuleDeliveryConfigPatchBody = {
  destinationWorkflowIdGhl?: string | null;
  destinationPipelineIdGhl?: string | null;
  destinationPipelineStageIdGhl?: string | null;
  defaultAssignedUserIdGhl?: string | null;
  backupSheetEnabled?: boolean;
  backupSheetId?: string | null;
  snapshotInstalled?: boolean;
  requiredFieldsInstalled?: boolean;
  ghlConnectionStatus?: string | null;
  deliveryMode?: string;
  deliveryEnabled?: boolean;
  clientCutoverApproved?: boolean;
  internalApprovalStatus?: string;
  opportunityCreationEnabled?: boolean;
  confirmLiveDeliveryRisk?: boolean;
};
