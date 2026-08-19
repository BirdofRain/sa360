export type AgedBulkSourceFormat = "vet_master_v1" | "trucker_master_v1";

export type AgedBulkMode =
  | "preview"
  | "commit"
  | "resume"
  | "reconcile"
  | "verify"
  | "activate"
  | "enrich-preview"
  | "enrich-commit";

/** Dedicated historical enrichment backfill — never reused for normal import commit. */
export const AGED_INVENTORY_BULK_ENRICH_COMMIT_CONFIRMATION =
  "ENRICH HISTORICAL MASTER INVENTORY" as const;

export type AgedBulkRowDisposition =
  | "accept"
  | "exact_source_duplicate"
  | "identity_duplicate_same_date"
  | "quarantine_identity_conflict"
  | "reject_no_identity"
  | "reject_invalid_state"
  | "reject_invalid_date"
  | "reject_invalid_name"
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
};

export type AgedBulkLeadDetailsPayload = {
  consumer_age: number | null;
  date_of_birth: string | null;
  beneficiary: string | null;
  niche: AgedBulkLeadDetailsNiche;
};

/** Internal Master provenance — never buyer-facing except intended sales context. */
export type AgedBulkInternalSource = {
  leadTypeRaw: string;
  dobAgeRaw: string;
  dateUsedLastRaw: string;
  usedByRaw: string;
  statusRaw: string;
  syncedRaw: string;
  rowNumber: number;
  sourceFormat: AgedBulkSourceFormat;
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
