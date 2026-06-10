import { parseGhlSa360CustomFieldIdMap } from "../lib/ghl-workspace-sync-env.js";
import {
  SA360_ALL_LOGICAL_FIELD_KEYS,
  SA360_CORE_REQUIRED_FIELD_KEYS,
  SA360_OPTIONAL_FIELD_KEYS,
  type Sa360LogicalFieldKey,
} from "../lib/sa360-custom-field-keys.js";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery/ghl-config-discovery.types.js";

export type Sa360CustomFieldIdMap = Record<string, string>;

export type Sa360FieldMappingSource = "destination_config" | "env_fallback" | "merged" | "none";

export type Sa360FieldMappingAssessment = {
  source: Sa360FieldMappingSource;
  idMap: Sa360CustomFieldIdMap;
  coreRequiredMapped: Sa360LogicalFieldKey[];
  coreRequiredMissing: Sa360LogicalFieldKey[];
  optionalMapped: Sa360LogicalFieldKey[];
  optionalMissing: Sa360LogicalFieldKey[];
  configuredGhlFieldIdCount: number;
  customFieldStampRequired: boolean;
  coreRequiredComplete: boolean;
};

export function parseSa360CustomFieldIdMapJson(value: unknown): Sa360CustomFieldIdMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Sa360CustomFieldIdMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

function normalizeDiscoveredFieldKey(field: GhlDiscoveredCustomField): string | null {
  const candidates = [field.fieldKey, field.key, field.name]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim().toLowerCase());
  for (const c of candidates) {
    if (!c.includes("sa360_")) continue;
    const match = SA360_ALL_LOGICAL_FIELD_KEYS.find(
      (k) => c === k || c.endsWith(k) || c.includes(k)
    );
    if (match) return match;
  }
  return null;
}

/** Build logical key → GHL field ID map from config discovery results (no hardcoded GHL IDs). */
export function buildSa360CustomFieldIdMapFromDiscovery(
  fields: GhlDiscoveredCustomField[]
): Sa360CustomFieldIdMap {
  const out: Sa360CustomFieldIdMap = {};
  for (const field of fields) {
    const logical = normalizeDiscoveredFieldKey(field);
    if (!logical || !field.id?.trim()) continue;
    if (!out[logical]) out[logical] = field.id.trim();
  }
  return out;
}

export function mergeSa360CustomFieldIdMaps(
  primary: Sa360CustomFieldIdMap,
  fallback: Sa360CustomFieldIdMap
): Sa360CustomFieldIdMap {
  return { ...fallback, ...primary };
}

export type ResolveSa360FieldMapInput = {
  destinationMapJson?: unknown;
  useEnvFallback?: boolean;
  customFieldStampRequired?: boolean;
};

export function resolveSa360CustomFieldIdMap(
  input: ResolveSa360FieldMapInput
): { idMap: Sa360CustomFieldIdMap; source: Sa360FieldMappingSource } {
  const destinationMap = parseSa360CustomFieldIdMapJson(input.destinationMapJson);
  const envMap = input.useEnvFallback !== false ? parseGhlSa360CustomFieldIdMap() : {};
  const destKeys = Object.keys(destinationMap).filter((k) => destinationMap[k]?.trim());
  const envKeys = Object.keys(envMap).filter((k) => envMap[k]?.trim());

  if (destKeys.length > 0 && envKeys.length > 0) {
    return { idMap: mergeSa360CustomFieldIdMaps(destinationMap, envMap), source: "merged" };
  }
  if (destKeys.length > 0) {
    return { idMap: destinationMap, source: "destination_config" };
  }
  if (envKeys.length > 0) {
    return { idMap: envMap, source: "env_fallback" };
  }
  return { idMap: {}, source: "none" };
}

export function assessSa360FieldMapping(
  idMap: Sa360CustomFieldIdMap,
  source: Sa360FieldMappingSource,
  customFieldStampRequired = false
): Sa360FieldMappingAssessment {
  const coreRequiredMapped = SA360_CORE_REQUIRED_FIELD_KEYS.filter((k) =>
    Boolean(idMap[k]?.trim())
  );
  const coreRequiredMissing = SA360_CORE_REQUIRED_FIELD_KEYS.filter(
    (k) => !idMap[k]?.trim()
  );
  const optionalMapped = SA360_OPTIONAL_FIELD_KEYS.filter((k) => Boolean(idMap[k]?.trim()));
  const optionalMissing = SA360_OPTIONAL_FIELD_KEYS.filter((k) => !idMap[k]?.trim());

  return {
    source,
    idMap,
    coreRequiredMapped: [...coreRequiredMapped],
    coreRequiredMissing: [...coreRequiredMissing],
    optionalMapped: [...optionalMapped],
    optionalMissing: [...optionalMissing],
    configuredGhlFieldIdCount: [...new Set(Object.values(idMap).filter((v) => v.trim()))].length,
    customFieldStampRequired,
    coreRequiredComplete: coreRequiredMissing.length === 0,
  };
}

export function resolveAndAssessSa360FieldMapping(
  input: ResolveSa360FieldMapInput
): Sa360FieldMappingAssessment {
  const { idMap, source } = resolveSa360CustomFieldIdMap(input);
  return assessSa360FieldMapping(idMap, source, input.customFieldStampRequired === true);
}

export type Sa360FieldMappingDiscoveryReport = {
  discoveredMap: Sa360CustomFieldIdMap;
  coreRequiredMapped: Sa360LogicalFieldKey[];
  coreRequiredMissing: Sa360LogicalFieldKey[];
  optionalMapped: Sa360LogicalFieldKey[];
  optionalMissing: Sa360LogicalFieldKey[];
  coreRequiredComplete: boolean;
};

export function buildSa360FieldMappingDiscoveryReport(
  fields: GhlDiscoveredCustomField[]
): Sa360FieldMappingDiscoveryReport {
  const discoveredMap = buildSa360CustomFieldIdMapFromDiscovery(fields);
  const assessment = assessSa360FieldMapping(discoveredMap, "destination_config", false);
  return {
    discoveredMap,
    coreRequiredMapped: assessment.coreRequiredMapped,
    coreRequiredMissing: assessment.coreRequiredMissing,
    optionalMapped: assessment.optionalMapped,
    optionalMissing: assessment.optionalMissing,
    coreRequiredComplete: assessment.coreRequiredComplete,
  };
}
