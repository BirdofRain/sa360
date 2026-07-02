export const LEAD_CLEANUP_STATUSES = {
  INCOMPLETE_MISSING_CLIENT_AND_NAME: "INCOMPLETE_MISSING_CLIENT_AND_NAME",
  REVIEW_REQUIRED_INCOMPLETE_IDENTITY: "REVIEW_REQUIRED_INCOMPLETE_IDENTITY",
} as const;

export const LEAD_CLEANUP_REASONS = {
  MISSING_CLIENT_FIRST_LAST: "missing_client_first_last",
  MISSING_ALL_IDENTITY_FIELDS: "missing_all_identity_fields",
  AMBIGUOUS_PARTIAL_IDENTITY_REVIEW_REQUIRED: "ambiguous_partial_identity_review_required",
} as const;

export type LeadCleanupStatus =
  (typeof LEAD_CLEANUP_STATUSES)[keyof typeof LEAD_CLEANUP_STATUSES];

export type LeadCleanupReason =
  (typeof LEAD_CLEANUP_REASONS)[keyof typeof LEAD_CLEANUP_REASONS];
