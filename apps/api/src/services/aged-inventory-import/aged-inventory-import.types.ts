import type { ImportFieldMapping } from "../bulk-import/bulk-import.types.js";

export const AGED_INVENTORY_CANONICAL_FIELDS = [
  "source_lead_id",
  "first_name",
  "last_name",
  "full_name",
  "phone",
  "email",
  "state",
  "generated_at",
  "niche",
  "product_type",
  "source_provider",
  "campaign_name",
] as const;

export type AgedInventoryCanonicalField = (typeof AGED_INVENTORY_CANONICAL_FIELDS)[number];

export type AgedInventoryDateFormat = "iso_date" | "iso_datetime" | "mdy_slash";

export type AgedInventoryRowClassification =
  | "ready"
  | "duplicate_in_file"
  | "existing_source_event"
  | "already_inventory"
  | "invalid_identity"
  | "invalid_state"
  | "generated_at_missing"
  | "generated_at_invalid"
  | "generated_at_ambiguous"
  | "future_generated_at"
  | "niche_missing"
  | "mapping_error"
  | "needs_review";

export type AgedInventoryParsedRowInput = {
  rowNumber: number;
  fields: Record<string, string>;
};

export type AgedInventoryNormalizedRow = {
  rowNumber: number;
  sourceLeadId: string;
  maskedSourceLeadId: string;
  firstName: string | null;
  lastName: string | null;
  phoneE164: string | null;
  email: string | null;
  state: string | null;
  generatedAt: Date | null;
  generatedAtSource: string | null;
  nicheKey: string | null;
  productType: string | null;
  sourceProviderLabel: string | null;
  campaignName: string | null;
  ageDays: number | null;
  ageBandKey: string | null;
  classification: AgedInventoryRowClassification;
  blockerCodes: string[];
  correctionHint: string | null;
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
};

export type AgedInventoryPreviewInput = {
  fileName: string;
  csvText: string;
  mapping?: ImportFieldMapping;
  dateFormat?: AgedInventoryDateFormat;
  defaultNicheKey?: string;
  defaultProductType?: string;
  uploadedBy?: string;
  evaluatedAt?: Date;
};

export type AgedInventoryCommitInput = {
  requestId: string;
  fileName: string;
  csvText: string;
  fileFingerprint: string;
  mapping: ImportFieldMapping;
  dateFormat?: AgedInventoryDateFormat;
  lotKey: string;
  lotDisplayName: string;
  inventoryClass: "aged";
  exclusivityMode: "exclusive" | "shared" | "configurable";
  nicheKey: string;
  productType?: string | null;
  sourceProvider: "manual_import";
  sourceLane?: string;
  operatorNote: string;
  confirmation: string;
  uploadedBy?: string;
};

export type AgedInventorySummaryCounts = {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  alreadyExisting: number;
  ready: number;
  quarantined: number;
  byState: Record<string, number>;
  byAgeBand: Record<string, number>;
  byClassification: Record<string, number>;
  byBlocker: Record<string, number>;
};
