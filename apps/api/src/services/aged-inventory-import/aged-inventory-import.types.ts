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
  "consumer_age",
] as const;

/**
 * Aged CSV import did not have a consumer_age canonical field. Commit wrote
 * only these normalized keys and a raw payload of { importRequestId, rowNumber },
 * so a source age cell was discarded and cannot be reconstructed from lead age.
 * `consumer_age` is now a canonical field. Historical rows stay unchanged
 * unless a stored payload still contains an explicit consumer-age value.
 */
export const AGED_INVENTORY_HISTORICAL_NORMALIZED_KEYS = [
  "firstName",
  "lastName",
  "email",
  "phone_e164",
  "state",
  "generated_at",
  "niche_key",
  "product_type",
] as const;

export const AGED_INVENTORY_HISTORICAL_RAW_PAYLOAD_RETAINS_SOURCE_CELLS = false;
export const AGED_INVENTORY_HISTORICAL_INITIAL_STATUS = "pending_review" as const;

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
  /** Parsed person age. Never derived from generatedAt. Null when the CSV has no usable age. */
  consumerAge?: string | null;
  /** Original mapped age cell, retained for audit. Not a lead date. */
  consumerAgeRaw?: string | null;
  /** ISO date of birth when the mapped cell was a recognized birthday. Never fabricated from an age. */
  dateOfBirth?: string | null;
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
