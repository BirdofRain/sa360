export type GhlDiscoveredPipelineStage = {
  id: string;
  name: string;
  position: number | null;
};

export type GhlDiscoveredPipeline = {
  id: string;
  name: string;
  stages: GhlDiscoveredPipelineStage[];
};

export type GhlDiscoveredWorkflow = {
  id: string;
  name: string;
  status: string | null;
  type: string | null;
};

export type GhlDiscoveredUser = {
  id: string;
  name: string;
  email: string | null;
};

export type GhlDiscoveredCustomField = {
  id: string;
  name: string;
  key: string | null;
  fieldKey: string | null;
  dataType: string | null;
};

export type GhlDiscoveredTag = {
  id: string;
  name: string;
};

export type GhlDiscoveredLocation = {
  id: string;
  name: string | null;
  companyId: string | null;
  timezone: string | null;
};

export type GhlRequiredFieldsReport = {
  requiredFieldsInstalled: boolean;
  missingRequiredFields: string[];
  foundRequiredFields: string[];
};

export type GhlLocationConfigDiscoveryResponse = {
  ok: true;
  location: GhlDiscoveredLocation;
  pipelines: GhlDiscoveredPipeline[];
  workflows: GhlDiscoveredWorkflow[];
  users: GhlDiscoveredUser[];
  customFields: GhlDiscoveredCustomField[];
  tags: GhlDiscoveredTag[];
  fetchedAt: string;
  fromCache: boolean;
  warnings: string[];
  errors: string[];
  requiredFields: GhlRequiredFieldsReport;
};

export type RoutingRuleGhlConfigSaveBody = {
  locationId: string;
  destinationPipelineIdGhl?: string | null;
  destinationPipelineStageIdGhl?: string | null;
  destinationWorkflowIdGhl?: string | null;
  defaultAssignedUserIdGhl?: string | null;
  snapshotInstalled?: boolean;
  requiredFieldsInstalled?: boolean;
  confirmLocationMismatch?: boolean;
};

export type RoutingRuleGhlConfigSaveResponse = {
  ok: true;
  item: import("@/lib/delivery-readiness/types").RoutingRuleWithReadinessItem;
  discoverySummary: { fetchedAt?: string; locationName?: string | null } | null;
};

export type RoutingRuleGhlConfigSummaryResponse = {
  ok: true;
  rule: {
    id: string;
    clientAccountId: string;
    destinationSubaccountIdGhl: string | null;
    destinationPipelineIdGhl: string | null;
    destinationPipelineStageIdGhl: string | null;
    destinationWorkflowIdGhl: string | null;
    defaultAssignedUserIdGhl: string | null;
    snapshotInstalled: boolean;
    requiredFieldsInstalled: boolean;
    ghlConnectionStatus: string | null;
  };
  discoverySummary: Record<string, unknown> | null;
};
