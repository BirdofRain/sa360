import {
  SA360_OPTION_MAPPED_FIELD_KEYS,
  type Sa360CustomFieldOptionMap,
} from "@sa360/shared";
import { isSa360CoreRequiredFieldKey } from "../lib/sa360-custom-field-keys.js";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery/ghl-config-discovery.types.js";
import {
  extractAllowedOptionsFromDiscoveredField,
  isValueAllowedForPicklist,
} from "./ghl-delivery-adapter/ghl-custom-field-picklist.js";
import { buildSa360CustomFieldIdMapFromDiscovery } from "./sa360-custom-field-mapping.service.js";

export type { Sa360CustomFieldOptionMap };

export type Sa360OptionMappingRowStatus = "mapped" | "missing" | "invalid";

export type Sa360OptionMappingRow = {
  logicalKey: string;
  canonicalValue: string;
  mappedGhlValue: string | null;
  status: Sa360OptionMappingRowStatus;
  discoveredGhlOptions: string[];
  isCoreRequired: boolean;
};

export type Sa360OptionMappingAssessment = {
  mappedFieldCount: number;
  totalCanonicalEntries: number;
  missingMappings: Array<{ logicalKey: string; canonicalValue: string }>;
  invalidMappings: Array<{ logicalKey: string; canonicalValue: string; mappedGhlValue: string }>;
  rows: Sa360OptionMappingRow[];
};

export function parseSa360CustomFieldOptionMapJson(value: unknown): Sa360CustomFieldOptionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Sa360CustomFieldOptionMap = {};
  for (const [fieldKey, fieldMap] of Object.entries(value as Record<string, unknown>)) {
    const logicalKey = fieldKey.trim();
    if (!logicalKey || !fieldMap || typeof fieldMap !== "object" || Array.isArray(fieldMap)) continue;
    const entries: Record<string, string> = {};
    for (const [canonical, ghlValue] of Object.entries(fieldMap as Record<string, unknown>)) {
      const ck = canonical.trim();
      const gv = typeof ghlValue === "string" ? ghlValue.trim() : "";
      if (ck && gv) entries[ck] = gv;
    }
    if (Object.keys(entries).length > 0) out[logicalKey] = entries;
  }
  return out;
}

export function mergeSa360CustomFieldOptionMaps(
  primary: Sa360CustomFieldOptionMap,
  fallback: Sa360CustomFieldOptionMap
): Sa360CustomFieldOptionMap {
  const out: Sa360CustomFieldOptionMap = { ...fallback };
  for (const [logicalKey, fieldMap] of Object.entries(primary)) {
    out[logicalKey] = { ...(out[logicalKey] ?? {}), ...fieldMap };
  }
  return out;
}

function lookupCanonicalInFieldMap(
  fieldMap: Record<string, string> | undefined,
  canonicalValue: string
): string | null {
  if (!fieldMap) return null;
  const direct = fieldMap[canonicalValue]?.trim();
  if (direct) return direct;
  const upper = canonicalValue.trim().toUpperCase();
  for (const [k, v] of Object.entries(fieldMap)) {
    if (k.trim().toUpperCase() === upper && v.trim()) return v.trim();
  }
  return null;
}

export function formatMissingOptionMappingMessage(logicalKey: string, canonicalValue: string): string {
  return `Missing option mapping: ${logicalKey} ${canonicalValue}`;
}

export function mapCanonicalToGhlOptionValue(
  logicalKey: string,
  canonicalValue: string,
  optionMap: Sa360CustomFieldOptionMap
): string | null {
  const trimmed = canonicalValue.trim();
  if (!trimmed) return null;
  return lookupCanonicalInFieldMap(optionMap[logicalKey], trimmed);
}

export function resolveOptionFieldStampValue(input: {
  logicalKey: string;
  canonicalValue: string;
  optionMap?: Sa360CustomFieldOptionMap;
  discovered?: GhlDiscoveredCustomField | null;
}): { ghlValue: string | null; reason: "mapped" | "direct_picklist_match" | "missing_mapping" | "invalid_mapped_value" } {
  const canonical = input.canonicalValue.trim();
  if (!canonical) return { ghlValue: null, reason: "missing_mapping" };

  const mapped = mapCanonicalToGhlOptionValue(input.logicalKey, canonical, input.optionMap ?? {});
  if (mapped) {
    const allowed = extractAllowedOptionsFromDiscoveredField(input.discovered);
    if (allowed.length > 0 && !isValueAllowedForPicklist(mapped, allowed)) {
      return { ghlValue: null, reason: "invalid_mapped_value" };
    }
    return { ghlValue: mapped, reason: "mapped" };
  }

  const allowed = extractAllowedOptionsFromDiscoveredField(input.discovered);
  if (allowed.length > 0 && isValueAllowedForPicklist(canonical, allowed)) {
    return { ghlValue: canonical, reason: "direct_picklist_match" };
  }

  return { ghlValue: null, reason: "missing_mapping" };
}

function indexDiscoveredByLogicalKey(
  fields: GhlDiscoveredCustomField[]
): Record<string, GhlDiscoveredCustomField> {
  const out: Record<string, GhlDiscoveredCustomField> = {};
  for (const field of fields) {
    const map = buildSa360CustomFieldIdMapFromDiscovery([field]);
    const logical = Object.keys(map)[0];
    if (logical && !out[logical]) out[logical] = field;
  }
  return out;
}

export function buildSa360OptionMappingRows(input: {
  optionMap: Sa360CustomFieldOptionMap;
  discoveredFields?: GhlDiscoveredCustomField[];
  canonicalValuesByField?: Record<string, string[]>;
}): Sa360OptionMappingRow[] {
  const discoveredByLogical = indexDiscoveredByLogicalKey(input.discoveredFields ?? []);
  const rows: Sa360OptionMappingRow[] = [];

  for (const logicalKey of SA360_OPTION_MAPPED_FIELD_KEYS) {
    const fieldMap = input.optionMap[logicalKey] ?? {};
    const discovered = discoveredByLogical[logicalKey];
    const discoveredGhlOptions = extractAllowedOptionsFromDiscoveredField(discovered);
    const canonicalValues =
      input.canonicalValuesByField?.[logicalKey] ??
      Object.keys(fieldMap).sort();

    const valuesToShow =
      canonicalValues.length > 0
        ? canonicalValues
        : discoveredGhlOptions.length > 0
          ? discoveredGhlOptions
          : [];

    if (valuesToShow.length === 0) continue;

    for (const canonicalValue of valuesToShow) {
      const mappedGhlValue = lookupCanonicalInFieldMap(fieldMap, canonicalValue);
      let status: Sa360OptionMappingRowStatus = "missing";
      if (mappedGhlValue) {
        status =
          discoveredGhlOptions.length > 0 &&
          !isValueAllowedForPicklist(mappedGhlValue, discoveredGhlOptions)
            ? "invalid"
            : "mapped";
      }
      rows.push({
        logicalKey,
        canonicalValue,
        mappedGhlValue,
        status,
        discoveredGhlOptions,
        isCoreRequired: isSa360CoreRequiredFieldKey(logicalKey),
      });
    }
  }

  return rows;
}

export function assessSa360OptionMappingReadiness(input: {
  optionMap: Sa360CustomFieldOptionMap;
  discoveredFields?: GhlDiscoveredCustomField[];
  valuesToStamp?: Record<string, string | null | undefined>;
}): Sa360OptionMappingAssessment {
  const rows: Sa360OptionMappingRow[] = [];
  const missingMappings: Array<{ logicalKey: string; canonicalValue: string }> = [];
  const invalidMappings: Array<{
    logicalKey: string;
    canonicalValue: string;
    mappedGhlValue: string;
  }> = [];

  const stampEntries = Object.entries(input.valuesToStamp ?? {}).filter(
    ([, v]) => typeof v === "string" && v.trim()
  );

  for (const [logicalKey, raw] of stampEntries) {
    if (!(SA360_OPTION_MAPPED_FIELD_KEYS as readonly string[]).includes(logicalKey)) continue;
    const canonicalValue = raw!.trim();
    const resolved = resolveOptionFieldStampValue({
      logicalKey,
      canonicalValue,
      optionMap: input.optionMap,
      discovered: indexDiscoveredByLogicalKey(input.discoveredFields ?? [])[logicalKey],
    });
    const discovered = indexDiscoveredByLogicalKey(input.discoveredFields ?? [])[logicalKey];
    const discoveredGhlOptions = extractAllowedOptionsFromDiscoveredField(discovered);
    const mappedGhlValue = lookupCanonicalInFieldMap(input.optionMap[logicalKey], canonicalValue);

    if (resolved.reason === "missing_mapping") {
      missingMappings.push({ logicalKey, canonicalValue });
      rows.push({
        logicalKey,
        canonicalValue,
        mappedGhlValue: null,
        status: "missing",
        discoveredGhlOptions,
        isCoreRequired: isSa360CoreRequiredFieldKey(logicalKey),
      });
      continue;
    }

    if (resolved.reason === "invalid_mapped_value" && mappedGhlValue) {
      invalidMappings.push({ logicalKey, canonicalValue, mappedGhlValue });
      rows.push({
        logicalKey,
        canonicalValue,
        mappedGhlValue,
        status: "invalid",
        discoveredGhlOptions,
        isCoreRequired: isSa360CoreRequiredFieldKey(logicalKey),
      });
      continue;
    }

    rows.push({
      logicalKey,
      canonicalValue,
      mappedGhlValue: resolved.ghlValue,
      status: "mapped",
      discoveredGhlOptions,
      isCoreRequired: isSa360CoreRequiredFieldKey(logicalKey),
    });
  }

  const mappedFieldCount = new Set(
    rows.filter((r) => r.status === "mapped").map((r) => r.logicalKey)
  ).size;

  return {
    mappedFieldCount,
    totalCanonicalEntries: rows.length,
    missingMappings,
    invalidMappings,
    rows,
  };
}

export function formatOptionMappingReadinessWarnings(
  assessment: Sa360OptionMappingAssessment
): string[] {
  const warnings: string[] = [];
  for (const m of assessment.missingMappings) {
    warnings.push(
      `${formatMissingOptionMappingMessage(m.logicalKey, m.canonicalValue)} is not mapped to a GHL option for this destination.`
    );
  }
  for (const inv of assessment.invalidMappings) {
    warnings.push(
      `${inv.logicalKey} value ${inv.canonicalValue} maps to "${inv.mappedGhlValue}" which is not in discovered GHL dropdown options.`
    );
  }
  return warnings;
}

/** Recommended future GHL snapshot options for sa360_routing_status. */
export const SA360_ROUTING_STATUS_SNAPSHOT_RECOMMENDATIONS = [
  "CREATED → created",
  "ROUTED → routed",
  "DELIVERED → delivered",
  "DELIVERY_FAILED → delivery_failed",
  "DUPLICATE_BLOCKED → duplicate_blocked",
] as const;
