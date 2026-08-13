/**
 * Canonical buyer / sales-context lead fields for PPL CSV v2.
 *
 * Storage preference (new intake):
 * {
 *   contact: { first_name, last_name, phone_e164, email, state },
 *   lead_details: {
 *     beneficiary?,
 *     coverage_amount?,
 *     niche?: { ...niche-specific optional fields }
 *   }
 * }
 *
 * Reuses normalizeSourceFieldKey from source-field-alias.registry for
 * punctuation/spacing-insensitive alias matching. Does not invent a competing
 * identity reader — identity still comes from readNormalizedLeadIdentity.
 */

import { normalizeSourceFieldKey } from "../source-intake/source-field-alias.registry.js";

export const BUYER_CSV_BASE_COLUMNS = [
  "first_name",
  "last_name",
  "phone",
  "email",
  "state",
  "lead_date",
  "niche",
  "beneficiary",
  "coverage_amount",
] as const;

export type BuyerCsvBaseColumn = (typeof BUYER_CSV_BASE_COLUMNS)[number];

/** Optional sales-context fields that must never affect eligibility. */
export const OPTIONAL_BUYER_SALES_CONTEXT_FIELDS = [
  "beneficiary",
  "coverage_amount",
  "branch_of_service",
  "disability_rating",
  "rig_type",
  "company_or_independent",
  "healthcare_profession",
  "primary_concern",
  "homeowner",
  "house_type",
] as const;

export type OptionalBuyerSalesContextField =
  (typeof OPTIONAL_BUYER_SALES_CONTEXT_FIELDS)[number];

export const NICHE_SPECIFIC_BUYER_COLUMNS = {
  vet: ["branch_of_service", "disability_rating"],
  trucker: ["rig_type", "company_or_independent"],
  nurse: ["healthcare_profession", "primary_concern"],
  mortgage: ["homeowner", "house_type"],
} as const;

export type BuyerCsvNicheKey = keyof typeof NICHE_SPECIFIC_BUYER_COLUMNS;

/**
 * Explicit alias lists. Order = precedence when multiple aliases are present
 * in a payload (first matching non-empty value wins; never overwrite).
 */
export const BUYER_FIELD_ALIASES: Record<
  OptionalBuyerSalesContextField,
  readonly string[]
> = {
  beneficiary: [
    "beneficiary",
    "Beneficiary",
    "beneficiary_name",
    "Beneficiary Name",
    "who_would_be_your_beneficiary",
    "who_is_coverage_for",
    "coverage_for",
  ],
  coverage_amount: [
    "coverage_amount",
    "Coverage Amount",
    "Coverage",
    "Desired Coverage",
    "coverageAmount",
    "desired_coverage",
    "desired_coverage_amount",
    "requested_coverage",
    "please_select_your_desired_coverage_amount",
  ],
  branch_of_service: [
    "branch_of_service",
    "Branch of Service",
    "Military Branch",
    "branch",
    "service_branch",
    "military_branch",
  ],
  disability_rating: [
    "disability_rating",
    "Disability Rating",
    "VA Disability Rating",
    "VA Rating",
    "disability_percentage",
  ],
  rig_type: ["rig_type", "Rig Type", "Truck Type", "type_of_rig"],
  company_or_independent: [
    "company_or_independent",
    "Company/Independent",
    "Company or Independent",
    "Driver Type",
    "owner_operator_status",
  ],
  healthcare_profession: [
    "healthcare_profession",
    "Healthcare Profession",
    "Profession",
    "Occupation",
    "Medical Profession",
  ],
  primary_concern: [
    "primary_concern",
    "Primary Concern",
    "main_concern",
    "Primary Need",
    "primary_reason",
    "reason_for_insurance",
  ],
  homeowner: [
    "homeowner",
    "Homeowner",
    "Home Owner",
    "owns_home",
    "home_ownership",
  ],
  house_type: [
    "house_type",
    "House Type",
    "Home Type",
    "property_type",
    "Property Type",
  ],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimString(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

export function normalizeBuyerNicheKey(nicheKey: string): string {
  return nicheKey.trim().toLowerCase();
}

export function nicheSpecificColumnsFor(nicheKey: string): readonly string[] {
  const key = normalizeBuyerNicheKey(nicheKey);
  if (key in NICHE_SPECIFIC_BUYER_COLUMNS) {
    return NICHE_SPECIFIC_BUYER_COLUMNS[key as BuyerCsvNicheKey];
  }
  return [];
}

export function buyerCsvColumnsForNiche(nicheKey: string): string[] {
  return [...BUYER_CSV_BASE_COLUMNS, ...nicheSpecificColumnsFor(nicheKey)];
}

function buildAliasLookup(): Map<string, OptionalBuyerSalesContextField> {
  const lookup = new Map<string, OptionalBuyerSalesContextField>();
  for (const field of OPTIONAL_BUYER_SALES_CONTEXT_FIELDS) {
    for (const alias of BUYER_FIELD_ALIASES[field]) {
      const normalized = normalizeSourceFieldKey(alias);
      if (!normalized) continue;
      // First registration wins — protects against silent cross-field overwrite.
      if (!lookup.has(normalized)) {
        lookup.set(normalized, field);
      }
    }
  }
  return lookup;
}

const ALIAS_LOOKUP = buildAliasLookup();

export function resolveBuyerFieldAlias(
  sourceKey: string
): OptionalBuyerSalesContextField | null {
  const normalized = normalizeSourceFieldKey(sourceKey);
  if (!normalized) return null;
  return ALIAS_LOOKUP.get(normalized) ?? null;
}

/**
 * Collect optional sales-context values with deterministic precedence:
 * 1) lead_details.niche.* / lead_details.* (canonical nest)
 * 2) sourceAttributes / routing.source_intake.sourceAttributes
 * 3) contact / flat payload direct keys via ordered alias list
 * Once a field is set, later sources cannot overwrite it.
 */
export function readOptionalBuyerSalesContextFields(
  normalizedPayloadJson: unknown
): Record<OptionalBuyerSalesContextField, string> {
  const empty = Object.fromEntries(
    OPTIONAL_BUYER_SALES_CONTEXT_FIELDS.map((field) => [field, ""])
  ) as Record<OptionalBuyerSalesContextField, string>;

  const payload = asRecord(normalizedPayloadJson);
  if (!payload) return empty;

  const result = { ...empty };
  const setIfEmpty = (field: OptionalBuyerSalesContextField, value: unknown) => {
    if (result[field]) return;
    const trimmed = trimString(value);
    if (trimmed) result[field] = trimmed;
  };

  const leadDetails = asRecord(payload.lead_details);
  if (leadDetails) {
    setIfEmpty("beneficiary", leadDetails.beneficiary);
    setIfEmpty("coverage_amount", leadDetails.coverage_amount);
    const niche = asRecord(leadDetails.niche);
    if (niche) {
      for (const field of OPTIONAL_BUYER_SALES_CONTEXT_FIELDS) {
        if (field === "beneficiary" || field === "coverage_amount") continue;
        setIfEmpty(field, niche[field]);
      }
    }
  }

  const routing = asRecord(payload.routing);
  const sourceIntake = routing ? asRecord(routing.source_intake) : null;
  const sourceAttributes =
    asRecord(payload.sourceAttributes) ??
    (sourceIntake ? asRecord(sourceIntake.sourceAttributes) : null);
  if (sourceAttributes) {
    for (const [key, value] of Object.entries(sourceAttributes)) {
      const field = resolveBuyerFieldAlias(key);
      if (field) setIfEmpty(field, value);
    }
  }

  const contact = asRecord(payload.contact);
  const bags: Record<string, unknown>[] = [payload];
  if (contact) bags.push(contact);
  if (leadDetails) bags.push(leadDetails);

  for (const field of OPTIONAL_BUYER_SALES_CONTEXT_FIELDS) {
    if (result[field]) continue;
    for (const alias of BUYER_FIELD_ALIASES[field]) {
      const normalizedAlias = normalizeSourceFieldKey(alias);
      for (const bag of bags) {
        for (const [key, value] of Object.entries(bag)) {
          if (normalizeSourceFieldKey(key) !== normalizedAlias) continue;
          setIfEmpty(field, value);
          if (result[field]) break;
        }
        if (result[field]) break;
      }
      if (result[field]) break;
    }
  }

  return result;
}

/** Build canonical lead_details nest from loose canonical/alias maps (intake helper). */
export function buildLeadDetailsFromCanonicalMap(
  canonical: Record<string, string>,
  nicheKey?: string
): {
  beneficiary?: string;
  coverage_amount?: string;
  niche?: Record<string, string>;
} {
  const optional = readOptionalBuyerSalesContextFields(canonical);
  const leadDetails: {
    beneficiary?: string;
    coverage_amount?: string;
    niche?: Record<string, string>;
  } = {};
  if (optional.beneficiary) leadDetails.beneficiary = optional.beneficiary;
  if (optional.coverage_amount) leadDetails.coverage_amount = optional.coverage_amount;

  const nicheFields = nicheSpecificColumnsFor(nicheKey ?? "");
  const niche: Record<string, string> = {};
  for (const field of nicheFields) {
    const value = optional[field as OptionalBuyerSalesContextField];
    if (value) niche[field] = value;
  }
  if (Object.keys(niche).length > 0) leadDetails.niche = niche;
  return leadDetails;
}

export type OptionalFieldCoverage = Record<string, { populated: number; total: number }>;

export function summarizeOptionalFieldCoverage(
  rows: Array<Record<string, string>>,
  columns: readonly string[]
): OptionalFieldCoverage {
  const optional = new Set<string>(OPTIONAL_BUYER_SALES_CONTEXT_FIELDS);
  const summary: OptionalFieldCoverage = {};
  for (const column of columns) {
    if (!optional.has(column)) continue;
    let populated = 0;
    for (const row of rows) {
      if ((row[column] ?? "").trim()) populated += 1;
    }
    summary[column] = { populated, total: rows.length };
  }
  return summary;
}
