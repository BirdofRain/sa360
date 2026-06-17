import type { BulkImportWizardStep } from "./types";

export const MAPPING_IGNORE = "__ignore__";
export const MAPPING_UNMAPPED = "__unmapped__";
export const MAPPING_CUSTOM_PREFIX = "custom:";

export type MappingSuggestion = {
  csvColumn: string;
  suggestedCanonical: string | null;
  confidence: "high" | "medium" | "low" | "none";
  action: "map" | "ignore" | "unmapped";
};

export type PreviewRow = { rowNumber: number; fields: Record<string, string> };

export const IDENTITY_FIELDS = [
  "first_name",
  "last_name",
  "full_name",
  "phone",
  "email",
  "state",
  "source_lead_id",
] as const;

export const LEAD_DETAIL_FIELDS = [
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
  "lead_created_at",
  "notes",
] as const;

export const ATTRIBUTION_FIELDS = [
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
] as const;

export const COMPLIANCE_FIELDS = ["trustedform_cert_url", "leadid_token", "vendor", "source"] as const;

export const ALL_STANDARD_FIELDS = [
  ...IDENTITY_FIELDS,
  ...LEAD_DETAIL_FIELDS,
  ...ATTRIBUTION_FIELDS,
  ...COMPLIANCE_FIELDS,
] as const;

const RESERVED_KEYS = new Set<string>(ALL_STANDARD_FIELDS);

export const FIELD_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  phone: "Phone",
  email: "Email",
  state: "State",
  source_lead_id: "Source lead ID",
  age: "Age",
  date_of_birth: "Date of birth",
  military_status: "Military status",
  branch_of_service: "Branch of service",
  sex: "Sex",
  marital_status: "Marital status",
  desired_coverage: "Desired coverage",
  primary_reason: "Primary reason",
  beneficiary: "Beneficiary",
  best_time_to_call: "Best time to call",
  applied_for_other_insurance: "Applied for other insurance",
  lead_created_at: "Lead created at",
  notes: "Notes",
  campaign_id: "Campaign ID",
  campaign_name: "Campaign name",
  utm_campaign: "UTM campaign",
  utm_source: "UTM source",
  utm_medium: "UTM medium",
  ad_id: "Ad ID",
  ad_name: "Ad name",
  adset_id: "Ad set ID",
  adset_name: "Ad set name",
  placement: "Placement",
  fbclid: "FBCLID",
  trustedform_cert_url: "TrustedForm cert URL",
  leadid_token: "LeadID token",
  vendor: "Vendor",
  source: "Source",
};

export function normalizeFieldKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s+\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function isCustomAttributeTarget(target: string): boolean {
  return target.startsWith(MAPPING_CUSTOM_PREFIX);
}

export function customKeyFromTarget(target: string): string {
  return target.slice(MAPPING_CUSTOM_PREFIX.length);
}

export function buildCustomTarget(key: string): string {
  return `${MAPPING_CUSTOM_PREFIX}${normalizeFieldKey(key)}`;
}

export function isReservedCustomKey(key: string): boolean {
  return RESERVED_KEYS.has(normalizeFieldKey(key));
}

export function confidenceBadgeLabel(
  suggestion: MappingSuggestion | undefined,
  csvColumn: string
): string {
  if (!suggestion || suggestion.confidence === "none") return "Unmapped";
  if (suggestion.confidence === "medium") return "Likely match";
  if (suggestion.confidence === "low") return "Review recommended";
  const normalizedHeader = normalizeFieldKey(csvColumn);
  if (suggestion.suggestedCanonical && normalizedHeader === suggestion.suggestedCanonical) {
    return "Exact match";
  }
  return "Recognized alias";
}

export type MappingRowStatus =
  | "required_mapped"
  | "required_missing"
  | "optional_mapped"
  | "preserved"
  | "ignored"
  | "custom"
  | "conflict";

export function mappingRowStatus(
  target: string,
  isConflict: boolean,
  requiredMissing: Set<string>
): MappingRowStatus {
  if (isConflict) return "conflict";
  if (target === MAPPING_IGNORE) return "ignored";
  if (target === MAPPING_UNMAPPED) return "preserved";
  if (isCustomAttributeTarget(target)) return "custom";
  if (target === "phone" && requiredMissing.has("phone")) return "required_missing";
  if (
    (target === "first_name" || target === "last_name" || target === "full_name") &&
    requiredMissing.has("name")
  ) {
    return "required_missing";
  }
  if (["phone", "first_name", "last_name", "full_name"].includes(target)) {
    return "required_mapped";
  }
  return "optional_mapped";
}

export function statusLabelText(status: MappingRowStatus): string {
  switch (status) {
    case "required_mapped":
      return "Required · Mapped";
    case "required_missing":
      return "Required · Missing";
    case "optional_mapped":
      return "Optional · Mapped";
    case "preserved":
      return "Preserved";
    case "ignored":
      return "Ignored";
    case "custom":
      return "Custom source attribute";
    case "conflict":
      return "Conflict";
    default:
      return "—";
  }
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `+${digits.startsWith("1") ? "1" : ""}•••${digits.slice(-4)}`;
}

export function maskEmail(value: string): string {
  const [user, domain] = value.split("@");
  if (!user || !domain) return "•••";
  return `${user[0] ?? ""}•••@${domain}`;
}

export function sanitizeSampleValue(header: string, value: string, showFull: boolean): string {
  if (showFull) return value;
  const key = normalizeFieldKey(header);
  if (key.includes("phone") || key === "mobile" || key === "cell") return maskPhone(value);
  if (key.includes("email")) return maskEmail(value);
  if (value.length > 48) return `${value.slice(0, 45)}…`;
  return value;
}

export function extractSampleValues(
  previewRows: PreviewRow[],
  header: string,
  showFull = false,
  limit = 3
): string[] {
  const samples: string[] = [];
  for (const row of previewRows) {
    const value = row.fields[header]?.trim();
    if (!value) continue;
    samples.push(sanitizeSampleValue(header, value, showFull));
    if (samples.length >= limit) break;
  }
  return samples;
}

export function detectCanonicalConflicts(
  mapping: Record<string, string>
): Array<{ canonical: string; csvColumns: string[] }> {
  const byTarget = new Map<string, string[]>();
  for (const [csvColumn, target] of Object.entries(mapping)) {
    if (target === MAPPING_IGNORE || target === MAPPING_UNMAPPED) continue;
    const list = byTarget.get(target) ?? [];
    list.push(csvColumn);
    byTarget.set(target, list);
  }
  return [...byTarget.entries()]
    .filter(([, cols]) => cols.length > 1)
    .map(([canonical, csvColumns]) => ({ canonical, csvColumns }));
}

export function summarizeMapping(mapping: Record<string, string>) {
  let standardMapped = 0;
  let customAttributes = 0;
  let preserved = 0;
  let ignored = 0;

  for (const target of Object.values(mapping)) {
    if (target === MAPPING_IGNORE) ignored++;
    else if (target === MAPPING_UNMAPPED) preserved++;
    else if (isCustomAttributeTarget(target)) customAttributes++;
    else standardMapped++;
  }

  return { standardMapped, customAttributes, preserved, ignored };
}

export function parseRequestedWizardStep(step: string | undefined): BulkImportWizardStep | undefined {
  if (!step) return undefined;
  const allowed: BulkImportWizardStep[] = [
    "upload",
    "map",
    "destination",
    "review",
    "simulate",
    "approve",
    "monitor",
    "results",
  ];
  return allowed.includes(step as BulkImportWizardStep) ? (step as BulkImportWizardStep) : undefined;
}

export function fieldLabel(canonical: string): string {
  return FIELD_LABELS[canonical] ?? canonical.replace(/_/g, " ");
}
