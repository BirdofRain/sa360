import type {
  BulkLeadImportRowDeliveryStatus,
  BulkLeadImportRowDuplicateStatus,
  BulkLeadImportRowValidationStatus,
  SourceLeadProvider,
  SourceLeadSystem,
  SourceLeadType,
} from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import type { SourceLeadRoutingResult } from "../source-intake/source-intake.types.js";

/** Future import sources (CSV, Google Sheets, vendor API, etc.). */
export interface BulkImportSource {
  kind: "csv_upload" | "google_sheet" | "pasted_rows" | "vendor_api" | "scheduled_file";
  fileName?: string;
  provider: SourceLeadProvider;
  sourceSystem: SourceLeadSystem;
  sourceType: SourceLeadType;
  importLabel?: string;
  uploadedBy?: string;
}

export type ParsedImportRow = {
  rowNumber: number;
  fields: Record<string, string>;
};

export type ImportFieldMapping = Record<string, string>;

export type ImportMappingSuggestion = {
  csvColumn: string;
  suggestedCanonical: string | null;
  confidence: "high" | "medium" | "low" | "none";
  action: "map" | "ignore" | "unmapped";
};

export type ImportDefaultValues = Record<string, string>;

export type BulkImportWorkflowStrategy =
  | "trigger_new_lead"
  | "source_tag_only"
  | "no_automation"
  | "aged_lead_workflow";

export type BulkImportOptions = {
  vendorLabel?: string;
  sourceTypeLabel?: string;
  nicheKey?: string;
  nicheLabel?: string;
  productType?: string;
  campaignLabel?: string;
  ownerOverrideIdGhl?: string;
  workflowStrategy?: BulkImportWorkflowStrategy;
  workflowWarningAcknowledged?: boolean;
  useExistingRoutingRules?: boolean;
  maxDeliveryWave?: number;
};

export type BulkImportNormalizationOptions = BulkImportOptions & {
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  readiness?: {
    readyForSimulation?: boolean;
  };
};

export type ImportNormalizationResult = {
  rowNumber: number;
  sourceLeadId: string;
  sourceLeadIdGenerated: boolean;
  normalized: LifecycleEventSchema;
  unmappedFields: Array<{ key: string; value: unknown }>;
  validationStatus: BulkLeadImportRowValidationStatus;
  duplicateStatus: BulkLeadImportRowDuplicateStatus;
  deliveryStatus: BulkLeadImportRowDeliveryStatus;
  blockerReasons: string[];
  duplicateCandidates: ImportDuplicateCandidate[];
};

export type ImportDuplicateCandidate = {
  kind: "within_batch" | "source_lead_id" | "phone" | "email" | "phone_email_review";
  rowNumber?: number;
  existingSourceLeadEventId?: string;
  detail: string;
  severity?:
    | "informational_cancelled_duplicate"
    | "blocking_delivered_duplicate"
    | "active_import_duplicate";
  originLabel?: string;
  deliveredToGhl?: boolean;
  previousBatchCancelled?: boolean;
  blocksReview?: boolean;
  sameSourceLeadId?: boolean;
  samePhone?: boolean;
  sameEmail?: boolean;
  previousImportLabel?: string;
  previousBatchId?: string;
};

export type ManualBulkImportRoutingDecision = {
  routingSource: "manual_bulk_import";
  routingAuthority: "operator_selected_destination";
  operator?: string;
  batchId: string;
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  nicheKey?: string;
  productType?: string;
  campaignLabel?: string;
  decidedAt: string;
};

export type BulkImportRowSummary = {
  totalRows: number;
  validIdentity: number;
  blockedIdentity: number;
  duplicateReview: number;
  mappingRequired: number;
  eligibleForSimulation: number;
  excluded: number;
};

export function buildImportRouteKey(batchId: string): string {
  return `IMPORT::${batchId}`;
}

export function buildManualImportRoutingResult(
  batchId: string,
  destinationClientAccountId: string,
  destinationLocationIdGhl: string,
  operator?: string,
  opts?: { nicheKey?: string; productType?: string; campaignLabel?: string }
): SourceLeadRoutingResult & { manualDecision: ManualBulkImportRoutingDecision } {
  const decidedAt = new Date().toISOString();
  return {
    matched: true,
    matchType: "manual_bulk_import",
    destinationClientAccountId,
    destinationLocationIdGhl,
    reason: "Operator-selected destination for bulk import batch",
    manualDecision: {
      routingSource: "manual_bulk_import",
      routingAuthority: "operator_selected_destination",
      operator,
      batchId,
      destinationClientAccountId,
      destinationLocationIdGhl,
      nicheKey: opts?.nicheKey,
      productType: opts?.productType,
      campaignLabel: opts?.campaignLabel,
      decidedAt,
    },
  };
}

export const BULK_IMPORT_IDENTITY_TARGETS = [
  "first_name",
  "last_name",
  "full_name",
  "phone",
  "email",
  "state",
  "source_lead_id",
] as const;

export const BULK_IMPORT_OPTIONAL_CANONICAL_FIELDS = [
  "age",
  "date_of_birth",
  "military_status",
  "branch_of_service",
  "sex",
  "marital_status",
  "desired_coverage",
  "primary_reason",
  "beneficiary",
  "best_time_to_call",
  "applied_for_other_insurance",
  "campaign_id",
  "campaign_name",
  "utm_campaign",
  "utm_source",
  "utm_medium",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "placement",
  "fbclid",
  "trustedform_cert_url",
  "leadid_token",
  "lead_created_at",
  "vendor",
  "source",
  "notes",
] as const;

export const BULK_IMPORT_IGNORE_COLUMN = "__ignore__";
export const BULK_IMPORT_UNMAPPED_COLUMN = "__unmapped__";
export const BULK_IMPORT_CUSTOM_ATTRIBUTE_PREFIX = "custom:" as const;
