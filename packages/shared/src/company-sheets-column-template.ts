/**
 * Versioned campaign column template.
 *
 * v1 and v2 headers stay machine keys and are not rewritten here.
 * v3 is a new contract: the same stored export fields, in a readable order.
 * Values still come from the campaign row mapper. This module only names
 * columns. It does not invent answers for fields the mapper does not read.
 */

export const COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 = "company_sheets_campaign_v3";

export const COMPANY_SHEETS_GENERATION_TIMEZONE = "America/New_York";

export type CompanySheetsColumnGroup = "identity" | "niche" | "enriched" | "technical";

export type CompanySheetsTemplateColumn = {
  header: string;
  /** Key on the v2 campaign row. The mapper owns how the value is chosen. */
  sourceField: string;
  group: CompanySheetsColumnGroup;
  help: string;
  /** System column the delivery writer always fills. */
  systemRequired: boolean;
};

export const COMPANY_SHEETS_V3_COLUMNS: readonly CompanySheetsTemplateColumn[] = [
  {
    header: "Date",
    sourceField: "submitted_at",
    group: "identity",
    systemRequired: false,
    help: "Original lead generation time in America/New_York. Blank when the source timestamp is missing. This is not the delivery time.",
  },
  {
    header: "Client Name",
    sourceField: "full_name",
    group: "identity",
    systemRequired: false,
    help: "Prospect or lead name, not the purchasing agent.",
  },
  {
    header: "Phone",
    sourceField: "phone",
    group: "identity",
    systemRequired: false,
    help: "Prospect phone from the stored contact fields.",
  },
  {
    header: "Email",
    sourceField: "email",
    group: "identity",
    systemRequired: false,
    help: "Prospect email from the stored contact fields.",
  },
  {
    header: "State",
    sourceField: "state",
    group: "identity",
    systemRequired: false,
    help: "Prospect state from the stored contact fields.",
  },
  {
    header: "Age",
    sourceField: "consumer_age",
    group: "niche",
    systemRequired: false,
    help: "Stored age only. Date of birth is not an export field.",
  },
  {
    header: "Military Status",
    sourceField: "military_status",
    group: "niche",
    systemRequired: false,
    help: "Veteran niche answer from the stored source attributes.",
  },
  {
    header: "Branch of Service",
    sourceField: "branch_of_service",
    group: "niche",
    systemRequired: false,
    help: "Veteran niche answer from the stored source attributes.",
  },
  {
    header: "Marital Status",
    sourceField: "marital_status",
    group: "niche",
    systemRequired: false,
    help: "Stored marital status.",
  },
  {
    header: "Desired Coverage",
    sourceField: "coverage_amount",
    group: "niche",
    systemRequired: false,
    help: "Stored coverage amount.",
  },
  {
    header: "Primary Concern",
    sourceField: "primary_reason",
    group: "niche",
    systemRequired: false,
    help: "Stored primary reason.",
  },
  {
    header: "Beneficiary",
    sourceField: "beneficiary",
    group: "niche",
    systemRequired: false,
    help: "Stored beneficiary.",
  },
  {
    header: "Time to Call",
    sourceField: "best_time_to_call",
    group: "niche",
    systemRequired: false,
    help: "Stored best time to call.",
  },
  {
    header: "First Name",
    sourceField: "first_name",
    group: "enriched",
    systemRequired: false,
    help: "Enriched given name. Kept even though the short visible sample omits it.",
  },
  {
    header: "Last Name",
    sourceField: "last_name",
    group: "enriched",
    systemRequired: false,
    help: "Enriched family name. Kept even though the short visible sample omits it.",
  },
  {
    header: "Sex",
    sourceField: "sex",
    group: "enriched",
    systemRequired: false,
    help: "Stored sex value.",
  },
  {
    header: "Provider Lead ID",
    sourceField: "provider_lead_id",
    group: "enriched",
    systemRequired: false,
    help: "Provider lead id when the source supplied one.",
  },
  {
    header: "Completion Minutes",
    sourceField: "completion_minutes",
    group: "enriched",
    systemRequired: false,
    help: "Stored completion minutes.",
  },
  {
    header: "Phone Verified",
    sourceField: "phone_verified",
    group: "enriched",
    systemRequired: false,
    help: "Stored phone verification flag.",
  },
  {
    header: "Email Verified",
    sourceField: "email_verified",
    group: "enriched",
    systemRequired: false,
    help: "Stored email verification flag.",
  },
  {
    header: "TrustedForm Status",
    sourceField: "trustedform_status",
    group: "enriched",
    systemRequired: false,
    help: "Stored TrustedForm status. The certificate URL is not copied.",
  },
  {
    header: "delivery_row_id",
    sourceField: "delivery_row_id",
    group: "technical",
    systemRequired: true,
    help: "Delivery identity. Separated from the columns a client reads.",
  },
  {
    header: "client_account_id",
    sourceField: "client_account_id",
    group: "technical",
    systemRequired: false,
    help: "SA360 client id for reconciliation.",
  },
  {
    header: "source_lead_event_id",
    sourceField: "source_lead_event_id",
    group: "technical",
    systemRequired: false,
    help: "SA360 source event id for reconciliation.",
  },
  {
    header: "received_at",
    sourceField: "received_at",
    group: "technical",
    systemRequired: false,
    help: "When SA360 received the lead. This is not the generation date in the Date column.",
  },
] as const;

export const COMPANY_SHEETS_V3_HEADER: readonly string[] = COMPANY_SHEETS_V3_COLUMNS.map((column) => column.header);

/**
 * Sample labels that are not stored export fields.
 * They stay visible in mapping review and are not written as columns.
 */
export const COMPANY_SHEETS_UNMAPPED_SAMPLE_LABELS = [
  {
    label: "Lead Type",
    reason: "No stored campaign export field maps to lead type.",
  },
  {
    label: "DOB",
    reason: "Date of birth is intentionally absent. Age is the stored field.",
  },
  {
    label: "Notes",
    reason: "No stored campaign export field maps to notes.",
  },
] as const;

const VET_NICHE_KEYS = new Set(["vet", "vet_fex", "n_vet", "veteran", "vet_life"]);

export type CompanySheetsTemplateNiche = "vet" | "unsupported";

export function companySheetsTemplateNiche(nicheKey: string | null | undefined): CompanySheetsTemplateNiche {
  const key = nicheKey?.trim().toLowerCase() ?? "";
  if (!key) return "unsupported";
  return VET_NICHE_KEYS.has(key) ? "vet" : "unsupported";
}

export function companySheetsV3HeaderMatches(actual: readonly string[] | null | undefined): boolean {
  if (!actual || actual.length < COMPANY_SHEETS_V3_HEADER.length) return false;
  return COMPANY_SHEETS_V3_HEADER.every((cell, index) => (actual[index] ?? "") === cell);
}
