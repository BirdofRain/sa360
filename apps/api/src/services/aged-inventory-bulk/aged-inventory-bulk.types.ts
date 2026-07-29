export type AgedBulkSourceFormat = "vet_master_v1" | "trucker_master_v1";

export type AgedBulkMode = "preview" | "commit" | "resume" | "reconcile" | "verify" | "activate";

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
  generatedAt: Date;
  nicheKey: string;
  campaignName: string | null;
  statusRaw: string | null;
  usedByPresent: boolean;
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
