import { parseGhlSa360CustomFieldIdMap } from "../lib/ghl-workspace-sync-env.js";
import {
  SA360_ALL_LOGICAL_FIELD_KEYS,
  SA360_CORE_REQUIRED_FIELD_KEYS,
  SA360_OPTIONAL_FIELD_KEYS,
  type Sa360LogicalFieldKey,
} from "../lib/sa360-custom-field-keys.js";
import { SA360_OPTION_MAPPED_FIELD_KEYS, type Sa360CustomFieldOptionMap } from "@sa360/shared";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery/ghl-config-discovery.types.js";

export type Sa360CustomFieldIdMap = Record<string, string>;
export type Sa360CustomFieldKeyMap = Record<string, string>;

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

/** Build logical key → GHL fieldKey (e.g. contact.sa360_lead_uid) from discovery. */
export function buildSa360CustomFieldKeyMapFromDiscovery(
  fields: GhlDiscoveredCustomField[]
): Sa360CustomFieldKeyMap {
  const out: Sa360CustomFieldKeyMap = {};
  for (const field of fields) {
    const logical = normalizeDiscoveredFieldKey(field);
    const fieldKey = field.fieldKey?.trim();
    if (!logical || !fieldKey) continue;
    if (!out[logical]) out[logical] = fieldKey;
  }
  return out;
}

export function parseSa360CustomFieldKeyMapJson(value: unknown): Sa360CustomFieldKeyMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Sa360CustomFieldKeyMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

/** Default GHL contact fieldKey for a SA360 logical key (contract: contact.{logicalKey}). */
export function defaultGhlContactFieldKeyForLogicalKey(logicalKey: string): string {
  return `contact.${logicalKey.trim()}`;
}

export function resolveSa360CustomFieldKeyMap(input: {
  destinationKeyMapJson?: unknown;
  discoveredFields?: GhlDiscoveredCustomField[];
}): Sa360CustomFieldKeyMap {
  const destinationMap = parseSa360CustomFieldKeyMapJson(input.destinationKeyMapJson);
  const discoveryMap = input.discoveredFields?.length
    ? buildSa360CustomFieldKeyMapFromDiscovery(input.discoveredFields)
    : {};
  const defaults: Sa360CustomFieldKeyMap = {};
  for (const logicalKey of SA360_ALL_LOGICAL_FIELD_KEYS) {
    defaults[logicalKey] = defaultGhlContactFieldKeyForLogicalKey(logicalKey);
  }
  return { ...defaults, ...discoveryMap, ...destinationMap };
}

export type Sa360FieldMappingAuditRow = {
  logicalKey: string;
  savedMappedValue: string | null;
  ghlFieldId: string | null;
  ghlFieldKey: string | null;
  ghlFieldName: string | null;
  ghlFieldType: string | null;
  writeIdentifierOk: boolean;
  mappingUsesFieldId: boolean;
  mappingUsesFieldKey: boolean;
  issue: string | null;
};

function findDiscoveredFieldForLogicalKey(
  logicalKey: string,
  fields: GhlDiscoveredCustomField[]
): GhlDiscoveredCustomField | null {
  for (const field of fields) {
    if (normalizeDiscoveredFieldKey(field) === logicalKey) return field;
  }
  return null;
}

/** Compare saved destination_config IDs against discovered GHL metadata for write readiness. */
export function auditSa360FieldMappingAgainstDiscovery(
  idMap: Sa360CustomFieldIdMap,
  fields: GhlDiscoveredCustomField[]
): Sa360FieldMappingAuditRow[] {
  const rows: Sa360FieldMappingAuditRow[] = [];
  for (const logicalKey of SA360_ALL_LOGICAL_FIELD_KEYS) {
    const savedMappedValue = idMap[logicalKey]?.trim() ?? null;
    const discovered = findDiscoveredFieldForLogicalKey(logicalKey, fields);
    const ghlFieldId = discovered?.id?.trim() ?? null;
    const ghlFieldKey = discovered?.fieldKey?.trim() ?? null;
    const ghlFieldName = discovered?.name?.trim() ?? null;
    const ghlFieldType = discovered?.dataType?.trim() ?? null;
    const mappingUsesFieldKey = Boolean(
      savedMappedValue &&
        (savedMappedValue.includes(".") ||
          savedMappedValue === ghlFieldKey ||
          savedMappedValue === discovered?.key)
    );
    const mappingUsesFieldId = Boolean(
      savedMappedValue && !mappingUsesFieldKey && savedMappedValue === ghlFieldId
    );
    let issue: string | null = null;
    if (!savedMappedValue) {
      issue = "not mapped in destination_config";
    } else if (mappingUsesFieldKey) {
      issue = "saved value looks like GHL field key, not field id";
    } else if (ghlFieldId && savedMappedValue !== ghlFieldId) {
      issue = "saved id does not match discovered GHL field id";
    } else if (!ghlFieldId && savedMappedValue) {
      issue = "mapped but field not found in latest discovery snapshot";
    }
    rows.push({
      logicalKey,
      savedMappedValue,
      ghlFieldId,
      ghlFieldKey,
      ghlFieldName,
      ghlFieldType,
      writeIdentifierOk: Boolean(savedMappedValue && mappingUsesFieldId),
      mappingUsesFieldId,
      mappingUsesFieldKey,
      issue,
    });
  }
  return rows.filter((row) => row.savedMappedValue || row.ghlFieldId);
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

export type Sa360FieldMappingSaveReport = {
  source: Sa360FieldMappingSource;
  coreMappedCount: number;
  coreMissing: Sa360LogicalFieldKey[];
  optionalMappedCount: number;
  optionalMissing: Sa360LogicalFieldKey[];
  coreRequiredComplete: boolean;
  savedKeyCount: number;
};

export function buildFieldMappingSaveReport(
  idMap: Sa360CustomFieldIdMap,
  customFieldStampRequired = false
): Sa360FieldMappingSaveReport {
  const assessment = assessSa360FieldMapping(idMap, "destination_config", customFieldStampRequired);
  return {
    source: assessment.source,
    coreMappedCount: assessment.coreRequiredMapped.length,
    coreMissing: assessment.coreRequiredMissing,
    optionalMappedCount: assessment.optionalMapped.length,
    optionalMissing: assessment.optionalMissing,
    coreRequiredComplete: assessment.coreRequiredComplete,
    savedKeyCount: Object.keys(idMap).filter((k) => idMap[k]?.trim()).length,
  };
}

export function assessCustomFieldStampReadiness(input: {
  idMap: Sa360CustomFieldIdMap;
  discoveredFields?: GhlDiscoveredCustomField[];
  optionMap?: Sa360CustomFieldOptionMap;
}): {
  coreMappingComplete: boolean;
  coreTextStampSafe: boolean;
  optionFieldsNeedValidation: Sa360LogicalFieldKey[];
} {
  const assessment = assessSa360FieldMapping(input.idMap, "destination_config", false);
  const discoveredByLogical: Record<string, GhlDiscoveredCustomField> = {};
  for (const field of input.discoveredFields ?? []) {
    const map = buildSa360CustomFieldIdMapFromDiscovery([field]);
    const logical = Object.keys(map)[0];
    if (logical && !discoveredByLogical[logical]) discoveredByLogical[logical] = field;
  }
  const optionFieldsNeedValidation: Sa360LogicalFieldKey[] = [];

  for (const logicalKey of [...assessment.coreRequiredMapped, ...assessment.optionalMapped]) {
    const discovered = discoveredByLogical[logicalKey];
    if (!discovered) continue;
    const dt = (discovered.dataType ?? "TEXT").trim().toUpperCase();
    if (
      dt === "SINGLE_OPTIONS" ||
      dt === "MULTIPLE_OPTIONS" ||
      dt === "CHECKBOX" ||
      dt === "RADIO" ||
      dt === "SINGLE_SELECT" ||
      dt === "MULTI_SELECT"
    ) {
      const optionFieldMap = input.optionMap?.[logicalKey];
      const hasOptionMappings =
        (SA360_OPTION_MAPPED_FIELD_KEYS as readonly string[]).includes(logicalKey) &&
        optionFieldMap &&
        Object.keys(optionFieldMap).length > 0;
      if (!hasOptionMappings) {
        optionFieldsNeedValidation.push(logicalKey);
      }
    }
  }

  const coreTextStampSafe = assessment.coreRequiredMapped.every((logicalKey) => {
    const discovered = discoveredByLogical[logicalKey];
    if (!discovered) return true;
    const dt = (discovered.dataType ?? "TEXT").trim().toUpperCase();
    return (
      dt === "TEXT" ||
      dt === "LARGE_TEXT" ||
      dt === "TEXTBOX" ||
      dt === "PHONE" ||
      dt === "EMAIL" ||
      dt === "URL" ||
      dt === "NUMERICAL" ||
      dt === "MONETORY" ||
      dt === "MONETARY" ||
      dt === "DATE" ||
      dt === "DATETIME"
    );
  });

  return {
    coreMappingComplete: assessment.coreRequiredComplete,
    coreTextStampSafe,
    optionFieldsNeedValidation,
  };
}

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
