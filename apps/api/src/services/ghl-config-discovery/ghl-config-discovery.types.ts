/** SA360 custom field keys used for delivery (read-only detection). */
export const SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS = [
  "sa360_lead_uid",
  "sa360_client_account_id",
  "sa360_niche_key",
  "sa360_niche_label",
  "sa360_source_platform",
  "sa360_source_type",
  "sa360_campaign_id",
  "sa360_campaign_name",
  "sa360_lifecycle_stage",
  "sa360_routing_status",
  "sa360_backend_sync_status",
  "sa360_delivery_idempotency_key",
  "sa360_delivery_plan_id",
  "sa360_delivery_mode",
] as const;

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

export type GhlConfigDiscoveryResult = {
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
