/**
 * Operator reading of one lead against discovered GHL field ids.
 * A blank source value on a resolved id is not described as a missing mapping.
 * A present source value with no discovered id is not described as delivered.
 */

/** Canonical survey answers an operator maps onto discovered GHL field ids. */
export const CANONICAL_SURVEY_ATTRIBUTES = [
  "best_time_to_call",
  "age",
  "marital_status",
  "desired_coverage",
  "branch_of_service",
  "primary_reason",
  "beneficiary",
  "military_status",
  "sex",
] as const;

export type GhlFieldCoverageRow = {
  key: string;
  fieldId: string | null;
  sourceValue: string | null;
};

export type GhlFieldCoverage = {
  mapped: GhlFieldCoverageRow[];
  missingMappings: GhlFieldCoverageRow[];
  missingSourceValues: GhlFieldCoverageRow[];
};

export function presentSourceValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function classifyGhlFieldCoverage(input: {
  sourceAttributes: Record<string, unknown>;
  mappings: Record<string, string>;
  discoveredIds: ReadonlySet<string>;
}): GhlFieldCoverage {
  const mapped: GhlFieldCoverageRow[] = [];
  const missingMappings: GhlFieldCoverageRow[] = [];
  const missingSourceValues: GhlFieldCoverageRow[] = [];
  const seen = new Set<string>();

  for (const [key, rawId] of Object.entries(input.mappings)) {
    const canonical = key.trim();
    const fieldId = rawId.trim();
    if (!canonical || !fieldId) continue;
    seen.add(canonical);
    const sourceValue = presentSourceValue(input.sourceAttributes[canonical]);
    if (!input.discoveredIds.has(fieldId)) {
      missingMappings.push({ key: canonical, fieldId, sourceValue });
      continue;
    }
    if (sourceValue === null) {
      missingSourceValues.push({ key: canonical, fieldId, sourceValue: null });
      continue;
    }
    mapped.push({ key: canonical, fieldId, sourceValue });
  }

  for (const [key, value] of Object.entries(input.sourceAttributes)) {
    const canonical = key.trim();
    if (!canonical || seen.has(canonical)) continue;
    const sourceValue = presentSourceValue(value);
    if (sourceValue === null) continue;
    missingMappings.push({ key: canonical, fieldId: null, sourceValue });
  }

  return { mapped, missingMappings, missingSourceValues };
}

export function savedFieldIds(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const canonical = key.trim();
    if (!canonical) continue;
    if (typeof value === "string" && value.trim()) {
      out[canonical] = value.trim();
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const field = value as Record<string, unknown>;
      const id =
        (typeof field.ghlFieldKey === "string" && field.ghlFieldKey.trim()) ||
        (typeof field.ghlFieldId === "string" && field.ghlFieldId.trim()) ||
        "";
      if (id) out[canonical] = id;
    }
  }
  return out;
}

export function resolveSavedFieldIds(
  saved: Record<string, string>,
  fields: ReadonlyArray<{ id: string; key?: string | null; fieldKey?: string | null }>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [canonical, stored] of Object.entries(saved)) {
    const match = fields.find(
      (field) => field.id === stored || field.fieldKey === stored || field.key === stored
    );
    out[canonical] = match?.id ?? stored;
  }
  return out;
}
