export type AgedBulkMasterSourceFormat = "vet_master_v1" | "trucker_master_v1";

export type AgedBulkNextGenSourceFormat = "leadcapture_nextgen_export_v1";

export type AgedBulkSourceFormat = AgedBulkMasterSourceFormat | AgedBulkNextGenSourceFormat;

export const AGED_BULK_NEXTGEN_SOURCE_FORMAT: AgedBulkNextGenSourceFormat =
  "leadcapture_nextgen_export_v1";

export function isMasterAgedBulkSourceFormat(
  sourceFormat: AgedBulkSourceFormat
): sourceFormat is AgedBulkMasterSourceFormat {
  return sourceFormat === "vet_master_v1" || sourceFormat === "trucker_master_v1";
}

export function isNextGenExportSourceFormat(
  sourceFormat: AgedBulkSourceFormat
): sourceFormat is AgedBulkNextGenSourceFormat {
  return sourceFormat === AGED_BULK_NEXTGEN_SOURCE_FORMAT;
}

/** Master-only workflows (enrich/recovery) must not run against NextGen exports. */
export function assertMasterOnlyAgedBulkFormat(
  sourceFormat: AgedBulkSourceFormat,
  workflow: "enrich" | "recovery"
): void {
  if (isNextGenExportSourceFormat(sourceFormat)) {
    throw new Error(`leadcapture_nextgen_export_v1_not_supported_for_master_${workflow}`);
  }
}

export type AgedBulkMode =
  | "preview"
  | "commit"
  | "resume"
  | "reconcile"
  | "verify"
  | "activate"
  | "enrich-preview"
  | "enrich-commit"
  | "recovery-preview"
  | "recovery-commit";

/** Dedicated historical enrichment backfill — never reused for normal import commit. */
export const AGED_INVENTORY_BULK_ENRICH_COMMIT_CONFIRMATION =
  "ENRICH HISTORICAL MASTER INVENTORY" as const;

/** Dedicated Master recovery create — never reused for enrich or ordinary import. */
export const AGED_INVENTORY_BULK_RECOVERY_COMMIT_CONFIRMATION =
  "CREATE HISTORICAL MASTER RECOVERY INVENTORY" as const;

/** Inclusive generated-date cut (YYYY-MM-DD) for HISTORICAL_PARSER_RECOVERY. */
export const RECOVERY_HISTORICAL_DATE_CUT_ISO = "2026-07-29" as const;

export type RecoveryDecision =
  | "EXISTING_EXACT"
  | "EXISTING_CONSUMER"
  | "AMBIGUOUS"
  | "FILE_DUPLICATE"
  | "INVALID"
  | "RECOVERY_CANDIDATE";

export type RecoveryGrouping = "HISTORICAL_PARSER_RECOVERY" | "POST_SNAPSHOT_MASTER_DELTA";

export type RecoveryAmbiguousReason =
  | "phone_email_diverge"
  | "multiple_identity_matches";

export type AgedBulkRowDisposition =
  | "accept"
  | "exact_source_duplicate"
  | "identity_duplicate_same_date"
  | "quarantine_identity_conflict"
  | "reject_no_identity"
  | "reject_invalid_state"
  | "reject_invalid_date"
  | "reject_invalid_name"
  | "reject_missing_source_lead_id"
  | "reject_future_date"
  | "reject_niche"
  | "already_inventory"
  | "email_issue_retained";

export type AgedBulkContactPayload = {
  first_name: string;
  last_name: string;
  phone_e164: string | null;
  email: string | null;
  state: string;
  zip: string | null;
};

export type AgedBulkLeadDetailsNiche = {
  branch_of_service?: string;
  disability_rating?: string;
  primary_concern?: string;
  company_or_independent?: string;
  rig_type?: string;
  military_status?: string;
  marital_status?: string;
  sex?: string;
  desired_coverage?: string;
};

export type AgedBulkLeadDetailsPayload = {
  consumer_age: number | null;
  date_of_birth: string | null;
  beneficiary: string | null;
  niche: AgedBulkLeadDetailsNiche;
};

/** Internal Master / NextGen provenance — never buyer-facing except intended sales context. */
export type AgedBulkInternalSource = {
  leadTypeRaw: string;
  dobAgeRaw: string;
  dateUsedLastRaw: string;
  usedByRaw: string;
  statusRaw: string;
  syncedRaw: string;
  rowNumber: number;
  sourceFormat: AgedBulkSourceFormat;
  /** Original CSV Lead # when the NextGen adapter preserves vendor identity. */
  originalSourceLeadId?: string;
  /** Original header → cell for every source column, including unmapped extras. */
  sourceColumns?: Record<string, string>;
};

export type AgedBulkNormalizedRow = {
  rowNumber: number;
  sourceLeadId: string;
  maskedSourceLeadId: string;
  firstName: string;
  lastName: string;
  phoneE164: string | null;
  email: string | null;
  emailIssue: string | null;
  state: string;
  zip: string | null;
  generatedAt: Date;
  nicheKey: string;
  campaignName: string | null;
  sourceFunnelName: string | null;
  /** Canonical source-attribute keys (military_status, ip_address, …). */
  sourceAttributes: Record<string, string>;
  statusRaw: string | null;
  usedByPresent: boolean;
  consumerAge: number | null;
  dateOfBirth: string | null;
  consumerAgeParseStatus: string;
  beneficiary: string | null;
  contact: AgedBulkContactPayload;
  leadDetails: AgedBulkLeadDetailsPayload;
  internalSource: AgedBulkInternalSource;
  disposition: AgedBulkRowDisposition;
  blockerCodes: string[];
};

export type AgedBulkAggregateCounts = {
  sourceRows: number;
  parsedRows: number;
  acceptedRows: number;
  exactDuplicateRows: number;
  quarantinedRows: number;
  rejectedRows: number;
  importedRows: number;
  emailIssueRetainedRows: number;
  pulledStatusRows: number;
  usedByPresentRows: number;
  byDisposition: Record<string, number>;
  byState: Record<string, number>;
  byAgeBand: Record<string, number>;
  byBlocker: Record<string, number>;
  earliestGeneratedAt: string | null;
  latestGeneratedAt: string | null;
};

/** Operator-facing preview block (dry-run). No production writes. */
export type AgedBulkPreviewReport = {
  totalCsvRows: number;
  parseableRows: number;
  rejectedRows: number;
  rejectionReasons: Record<string, number>;
  duplicateCandidates: number;
  byState: Record<string, number>;
  byAgeBand: Record<string, number>;
  earliestCreated: string | null;
  latestCreated: string | null;
};

export type AgedBulkCliArgs = {
  mode: AgedBulkMode;
  file: string;
  sourceFormat: AgedBulkSourceFormat;
  defaultNiche: string;
  batchSize: number;
  workDir: string;
  expectedFileSha256: string;
  expectedDbHost: string;
  operator: string;
  confirmation?: string;
  lotKey?: string;
  requestId?: string;
  operatorNote?: string;
};
