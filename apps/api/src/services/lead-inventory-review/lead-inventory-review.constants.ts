import {
  LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
  LEAD_INVENTORY_REVIEW_MAX_ITEMS,
  LEAD_INVENTORY_REVIEW_OPERATOR_NOTE_MAX_CHARS,
  LEAD_INVENTORY_REVIEW_QUARANTINE_CONFIRMATION,
  LEAD_INVENTORY_REVIEW_REJECT_CONFIRMATION,
} from "@sa360/shared";

export const REVIEW_MAX_ITEMS = LEAD_INVENTORY_REVIEW_MAX_ITEMS;
export const REVIEW_OPERATOR_NOTE_MAX_CHARS = LEAD_INVENTORY_REVIEW_OPERATOR_NOTE_MAX_CHARS;

export const REVIEW_CONFIRMATION = {
  make_available: LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
  quarantine: LEAD_INVENTORY_REVIEW_QUARANTINE_CONFIRMATION,
  reject: LEAD_INVENTORY_REVIEW_REJECT_CONFIRMATION,
} as const;

export type LeadInventoryReviewActionTypeKey = keyof typeof REVIEW_CONFIRMATION;

export const REVIEW_AVAILABILITY_REASON_CODES = ["review_passed"] as const;

export const REVIEW_QUARANTINE_REASON_CODES = [
  "duplicate_requires_investigation",
  "identity_requires_investigation",
  "provenance_requires_investigation",
  "invalid_geography",
  "invalid_age",
  "source_lane_requires_investigation",
  "compliance_requires_investigation",
  "operator_quarantine",
] as const;

export const REVIEW_REJECT_REASON_CODES = [
  "invalid_record",
  "confirmed_duplicate",
  "unusable_identity",
  "unsupported_geography",
  "unsupported_product",
  "missing_required_provenance",
  "operator_rejected",
] as const;

export const REVIEW_BLOCKER_CODES = [
  "status_not_pending_review",
  "invalid_state",
  "generated_at_missing_or_invalid",
  "age_band_unresolved",
  "source_provider_unrecognized",
  "source_lane_unrecognized",
  "inventory_lot_missing",
  "source_event_missing",
  "import_provenance_missing",
  "identity_normalization_incomplete",
  "duplicate_status_unchecked",
  "duplicate_detected",
  "duplicate_possible_match",
  "quarantine_reason_present",
  "allocation_conflict",
  "delivery_history_present",
  "fulfillment_limit_invalid",
  "required_fields_missing",
  "commercial_policy_blocked",
] as const;

export type ReviewBlockerCode = (typeof REVIEW_BLOCKER_CODES)[number];

/** Recognized inventory source lanes for review activation v1. */
export const REVIEW_RECOGNIZED_SOURCE_LANES = new Set([
  "aged_inventory_csv",
  "leadcapture_io",
  "facebook_meta_lead_ads",
  "meta_lead_ads",
  "leadconduit_facebook",
]);

export const REVIEW_RECOGNIZED_PROVIDERS = new Set([
  "leadcapture_io",
  "facebook",
  "goat_leads",
  "manual_import",
  "google_sheets",
]);

export const US_STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);
