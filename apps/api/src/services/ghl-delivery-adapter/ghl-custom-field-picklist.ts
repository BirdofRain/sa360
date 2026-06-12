import type { GhlDiscoveredCustomField } from "../ghl-config-discovery/ghl-config-discovery.types.js";

export function normalizePicklistOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    for (const key of ["label", "preFillValue", "prefillValue", "value", "name"]) {
      const v = record[key];
      if (typeof v === "string" && v.trim()) {
        out.push(v.trim());
        break;
      }
    }
  }
  return [...new Set(out)];
}

export function extractAllowedOptionsFromDiscoveredField(
  field: GhlDiscoveredCustomField | null | undefined
): string[] {
  if (!field) return [];
  const record = field as GhlDiscoveredCustomField & Record<string, unknown>;
  if (Array.isArray(field.picklistOptions) && field.picklistOptions.length > 0) {
    return [...new Set(field.picklistOptions.map((v) => v.trim()).filter(Boolean))];
  }
  return normalizePicklistOptions(record.picklistOptions ?? record.options ?? record.optionList);
}

export function isValueAllowedForPicklist(value: string, allowedOptions: string[]): boolean {
  if (allowedOptions.length === 0) return false;
  const normalized = value.trim().toLowerCase();
  return allowedOptions.some((opt) => opt.trim().toLowerCase() === normalized);
}
