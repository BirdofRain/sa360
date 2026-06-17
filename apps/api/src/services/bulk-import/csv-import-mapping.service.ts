import {
  CANONICAL_SOURCE_ATTRIBUTE_KEYS,
  DEFAULT_SOURCE_FIELD_ALIASES,
  normalizeSourceFieldKey,
  resolveCanonicalAttributeKey,
} from "../source-intake/source-field-alias.registry.js";
import {
  BULK_IMPORT_IDENTITY_TARGETS,
  BULK_IMPORT_IGNORE_COLUMN,
  BULK_IMPORT_OPTIONAL_CANONICAL_FIELDS,
  BULK_IMPORT_UNMAPPED_COLUMN,
  type ImportFieldMapping,
  type ImportMappingSuggestion,
} from "./bulk-import.types.js";

const ALL_CANONICAL = [
  ...BULK_IMPORT_IDENTITY_TARGETS,
  ...BULK_IMPORT_OPTIONAL_CANONICAL_FIELDS,
  ...CANONICAL_SOURCE_ATTRIBUTE_KEYS,
] as const;

const HEADER_ALIAS_HINTS: Record<string, string> = {
  first: "first_name",
  firstname: "first_name",
  fname: "first_name",
  last: "last_name",
  lastname: "last_name",
  lname: "last_name",
  fullname: "full_name",
  name: "full_name",
  phone: "phone",
  phone_number: "phone",
  mobile: "phone",
  cell: "phone",
  email: "email",
  email_address: "email",
  state: "state",
  st: "state",
  lead_id: "source_lead_id",
  leadid: "source_lead_id",
  ref_id: "source_lead_id",
  vendor_lead_id: "source_lead_id",
  dob: "date_of_birth",
  birth_date: "date_of_birth",
  branch: "branch_of_service",
  military_branch: "branch_of_service",
  coverage: "desired_coverage",
  time_to_call: "best_time_to_call",
  created_at: "lead_created_at",
  submitted_at: "lead_created_at",
};

function scoreHeaderMatch(header: string, canonical: string): "high" | "medium" | "low" | "none" {
  const normalizedHeader = normalizeSourceFieldKey(header);
  const aliases = DEFAULT_SOURCE_FIELD_ALIASES[canonical as keyof typeof DEFAULT_SOURCE_FIELD_ALIASES];
  if (normalizedHeader === canonical) return "high";
  if (aliases?.some((a) => normalizeSourceFieldKey(a) === normalizedHeader)) return "high";
  const hint = HEADER_ALIAS_HINTS[normalizedHeader];
  if (hint === canonical) return "medium";
  const resolved = resolveCanonicalAttributeKey(header);
  if (resolved === canonical) return "medium";
  if (normalizedHeader.includes(canonical.replace(/_/g, ""))) return "low";
  return "none";
}

export function suggestFieldMappings(headers: string[]): ImportMappingSuggestion[] {
  return headers.map((csvColumn) => {
    let bestCanonical: string | null = null;
    let bestConfidence: ImportMappingSuggestion["confidence"] = "none";

    for (const canonical of ALL_CANONICAL) {
      const score = scoreHeaderMatch(csvColumn, canonical);
      if (score === "none") continue;
      const rank = { high: 4, medium: 3, low: 2, none: 0 }[score];
      const bestRank = bestConfidence === "none" ? 0 : { high: 4, medium: 3, low: 2, none: 0 }[bestConfidence];
      if (rank > bestRank) {
        bestCanonical = canonical;
        bestConfidence = score;
      }
    }

    return {
      csvColumn,
      suggestedCanonical: bestCanonical,
      confidence: bestConfidence,
      action: bestCanonical ? "map" : "unmapped",
    };
  });
}

export function buildMappingFromSuggestions(
  suggestions: ImportMappingSuggestion[],
  overrides?: ImportFieldMapping
): ImportFieldMapping {
  const mapping: ImportFieldMapping = {};
  for (const s of suggestions) {
    if (overrides && overrides[s.csvColumn] !== undefined) {
      mapping[s.csvColumn] = overrides[s.csvColumn]!;
      continue;
    }
    if (s.suggestedCanonical && s.confidence !== "none") {
      mapping[s.csvColumn] = s.suggestedCanonical;
    } else {
      mapping[s.csvColumn] = BULK_IMPORT_UNMAPPED_COLUMN;
    }
  }
  if (overrides) {
    for (const [col, target] of Object.entries(overrides)) {
      mapping[col] = target;
    }
  }
  return mapping;
}

export function listMissingRequiredMappings(mapping: ImportFieldMapping): string[] {
  const mappedTargets = new Set(
    Object.values(mapping).filter((v) => v !== BULK_IMPORT_IGNORE_COLUMN && v !== BULK_IMPORT_UNMAPPED_COLUMN)
  );
  const missing: string[] = [];
  const hasName =
    mappedTargets.has("first_name") ||
    mappedTargets.has("last_name") ||
    mappedTargets.has("full_name");
  if (!hasName) missing.push("name");
  if (!mappedTargets.has("phone")) missing.push("phone");
  if (!mappedTargets.has("source_lead_id")) missing.push("source_lead_id");
  return missing;
}

export function applyFieldMapping(
  fields: Record<string, string>,
  mapping: ImportFieldMapping,
  defaults?: Record<string, string>
): { canonical: Record<string, string>; unmapped: Array<{ key: string; value: string }> } {
  const canonical: Record<string, string> = { ...(defaults ?? {}) };
  const unmapped: Array<{ key: string; value: string }> = [];

  for (const [csvColumn, value] of Object.entries(fields)) {
    const target = mapping[csvColumn] ?? BULK_IMPORT_UNMAPPED_COLUMN;
    if (!value?.trim()) continue;
    if (target === BULK_IMPORT_IGNORE_COLUMN) continue;
    if (target === BULK_IMPORT_UNMAPPED_COLUMN) {
      unmapped.push({ key: csvColumn, value });
      continue;
    }
    if (!canonical[target]) {
      canonical[target] = value.trim();
    }
  }

  return { canonical, unmapped };
}

export function splitFullName(fullName: string): { first_name?: string; last_name?: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first_name: parts[0] };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}
