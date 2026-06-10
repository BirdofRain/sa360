import type { CampaignRoutingRule, LeadDeliveryPlan, LeadDeliveryPlanStep } from "@prisma/client";

export type GhlDestinationFieldMappingConfig = {
  sa360CustomFieldIdMapJson: unknown;
  customFieldStampRequired: boolean;
  ownerAssignmentRequired: boolean;
  workflowStartRequired: boolean;
};

export type GhlAdapterPlanContext = {
  plan: LeadDeliveryPlan & { steps: LeadDeliveryPlanStep[] };
  rule: CampaignRoutingRule | null;
  destinationFieldMapping?: GhlDestinationFieldMappingConfig | null;
};

export type GhlValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  missingConfig: string[];
};

export type GhlContactUpsertPreview = {
  method: "POST";
  path: "/contacts/upsert";
  locationId: string;
  body: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    state: string | null;
    source: string;
    customFields: Record<string, string | null>;
  };
};

export type GhlCustomFieldStampPreview = {
  method: "PUT";
  path: "/contacts/:contactId";
  locationId: string;
  customFields: Record<string, string | null>;
};

export type GhlTagPreview = {
  method: "POST";
  path: "/contacts/:contactId/tags";
  locationId: string;
  tags: string[];
};

export type GhlOpportunityPreview = {
  method: "POST";
  path: "/opportunities/";
  locationId: string;
  body: {
    pipelineId: string;
    pipelineStageId: string;
    contactId: string | null;
    name: string;
    status: "open";
  };
};

export type GhlAssignOwnerPreview = {
  method: "PUT";
  path: "/contacts/:contactId";
  locationId: string;
  assignedTo: string;
};

export type GhlWorkflowStartPreview = {
  method: "POST";
  path: "/contacts/:contactId/workflow/:workflowId";
  locationId: string;
  workflowId: string;
};

export type GhlBackupSheetPreview = {
  targetSystem: "google_sheets";
  method: "APPEND";
  spreadsheetId: string | null;
  rowPreview: Record<string, string | null>;
};

export type GhlAdapterSimulationResult = {
  mode: string;
  status: string;
  validation: GhlValidationResult;
  stepDrafts: GhlAdapterStepDraft[];
  summary: string;
  warnings: string[];
  errors: string[];
  probeResult?: { ok: boolean; detail: string };
};

export type GhlAdapterStepDraft = {
  deliveryPlanStepId: string | null;
  stepOrder: number;
  stepType: string;
  targetSystem: string;
  targetId: string | null;
  mode: string;
  status: string;
  title: string;
  requestPreviewJson: Record<string, unknown> | null;
  responsePreviewJson: Record<string, unknown> | null;
  validationErrors: string[];
  warnings: string[];
};
