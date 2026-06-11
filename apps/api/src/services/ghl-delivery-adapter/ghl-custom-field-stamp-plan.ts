import {
  SA360_CORE_REQUIRED_FIELD_KEYS,
  type Sa360LogicalFieldKey,
} from "../../lib/sa360-custom-field-keys.js";
import type { GhlDiscoveredCustomField } from "../ghl-config-discovery/ghl-config-discovery.types.js";
import {
  buildSa360CustomFieldIdMapFromDiscovery,
  defaultGhlContactFieldKeyForLogicalKey,
} from "../sa360-custom-field-mapping.service.js";
import {
  buildCustomFieldsForPutFromMap,
  isPlausibleGhlCustomFieldId,
  type CustomFieldStampBuildResult,
  type GhlCustomFieldPutDiagnostic,
} from "./ghl-live-transport.js";

export type GhlCustomFieldTypeCategory = "text_safe" | "numeric" | "date" | "option" | "unknown_unsafe";

export type SkippedCustomFieldReason =
  | "option_field_no_allowed_values"
  | "option_value_not_in_allowed_list"
  | "unsafe_type_without_metadata"
  | "invalid_numeric_value"
  | "invalid_date_value"
  | "no_field_id_mapping";

export type SkippedCustomFieldEntry = {
  logicalKey: string;
  dataType: string | null;
  reason: SkippedCustomFieldReason;
  message: string;
  isCoreRequired: boolean;
};

export type TypedCustomFieldStampPlan = {
  textBatch: CustomFieldStampBuildResult;
  optionBatch: CustomFieldStampBuildResult;
  skipped: SkippedCustomFieldEntry[];
  attemptedTextFields: string[];
  skippedOptionFields: string[];
  unsatisfiedRequiredCoreFields: Sa360LogicalFieldKey[];
};

const OPTION_DATA_TYPES = new Set([
  "SINGLE_OPTIONS",
  "MULTIPLE_OPTIONS",
  "CHECKBOX",
  "RADIO",
  "SINGLE_SELECT",
  "MULTI_SELECT",
]);

const TEXT_SAFE_DATA_TYPES = new Set([
  "TEXT",
  "LARGE_TEXT",
  "TEXTBOX",
  "PHONE",
  "EMAIL",
  "URL",
]);

export function indexDiscoveredCustomFieldsByLogicalKey(
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

export function classifyGhlCustomFieldDataType(dataType: string | null | undefined): GhlCustomFieldTypeCategory {
  const dt = (dataType ?? "TEXT").trim().toUpperCase();
  if (TEXT_SAFE_DATA_TYPES.has(dt)) return "text_safe";
  if (OPTION_DATA_TYPES.has(dt)) return "option";
  if (dt === "NUMERICAL" || dt === "MONETORY" || dt === "MONETARY") return "numeric";
  if (dt === "DATE" || dt === "DATETIME") return "date";
  if (!dataType?.trim()) return "text_safe";
  return "unknown_unsafe";
}

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

export function isNumericCustomFieldValue(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

export function isDateCompatibleCustomFieldValue(value: string): boolean {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return true;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed);
}

function isCoreRequiredLogicalKey(key: string): key is Sa360LogicalFieldKey {
  return (SA360_CORE_REQUIRED_FIELD_KEYS as readonly string[]).includes(key);
}

function pushPutItem(
  batch: CustomFieldStampBuildResult,
  input: {
    logicalKey: string;
    ghlFieldId: string;
    ghlFieldKey: string;
    value: string;
    dataType: string | null;
  },
  usedGhlIds: Set<string>
): void {
  if (usedGhlIds.has(input.ghlFieldId)) return;
  usedGhlIds.add(input.ghlFieldId);
  const item = { id: input.ghlFieldId, key: input.ghlFieldKey, field_value: input.value };
  batch.apiPayload.push(item);
  batch.diagnostics.push({
    logicalKey: input.logicalKey,
    ghlFieldId: input.ghlFieldId,
    ghlFieldKey: input.ghlFieldKey,
    mappingIdentifierType: "field_id",
    itemKeys: Object.keys(item).sort(),
    valueProperty: "field_value",
    valueType: "string",
    valueLength: input.value.length,
    dataType: input.dataType,
  });
}

export function buildTypedCustomFieldStampPlan(input: {
  idMap: Record<string, string>;
  values: Record<string, string | null | undefined>;
  keyMap?: Record<string, string>;
  discoveredFields?: GhlDiscoveredCustomField[];
}): TypedCustomFieldStampPlan {
  const discoveredByLogical = indexDiscoveredCustomFieldsByLogicalKey(input.discoveredFields ?? []);
  const textBatch: CustomFieldStampBuildResult = { apiPayload: [], diagnostics: [] };
  const optionBatch: CustomFieldStampBuildResult = { apiPayload: [], diagnostics: [] };
  const skipped: SkippedCustomFieldEntry[] = [];
  const attemptedTextFields: string[] = [];
  const skippedOptionFields: string[] = [];
  const usedTextIds = new Set<string>();
  const usedOptionIds = new Set<string>();

  for (const [logicalKey, raw] of Object.entries(input.values)) {
    const value = raw?.trim();
    if (!value) continue;
    const ghlFieldId = input.idMap[logicalKey]?.trim();
    if (!ghlFieldId || !isPlausibleGhlCustomFieldId(ghlFieldId)) {
      skipped.push({
        logicalKey,
        dataType: discoveredByLogical[logicalKey]?.dataType ?? null,
        reason: "no_field_id_mapping",
        message: `Skipped ${logicalKey} — no valid GHL field id in destination_config mapping.`,
        isCoreRequired: isCoreRequiredLogicalKey(logicalKey),
      });
      continue;
    }

    const discovered = discoveredByLogical[logicalKey] ?? null;
    const hasDiscovery = (input.discoveredFields?.length ?? 0) > 0;
    if (hasDiscovery && !discovered) {
      skipped.push({
        logicalKey,
        dataType: null,
        reason: "unsafe_type_without_metadata",
        message: `Skipped ${logicalKey} — field not found in latest discovery snapshot.`,
        isCoreRequired: isCoreRequiredLogicalKey(logicalKey),
      });
      continue;
    }

    const dataType = discovered?.dataType ?? null;
    const category = classifyGhlCustomFieldDataType(dataType);
    const ghlFieldKey =
      input.keyMap?.[logicalKey]?.trim() ??
      discovered?.fieldKey?.trim() ??
      defaultGhlContactFieldKeyForLogicalKey(logicalKey);

    if (category === "text_safe") {
      attemptedTextFields.push(logicalKey);
      pushPutItem(
        textBatch,
        { logicalKey, ghlFieldId, ghlFieldKey, value, dataType },
        usedTextIds
      );
      continue;
    }

    if (category === "numeric") {
      if (!isNumericCustomFieldValue(value)) {
        skipped.push({
          logicalKey,
          dataType,
          reason: "invalid_numeric_value",
          message: `Skipped ${logicalKey} — value is not numeric for NUMERICAL field.`,
          isCoreRequired: isCoreRequiredLogicalKey(logicalKey),
        });
        continue;
      }
      attemptedTextFields.push(logicalKey);
      pushPutItem(
        textBatch,
        { logicalKey, ghlFieldId, ghlFieldKey, value, dataType },
        usedTextIds
      );
      continue;
    }

    if (category === "date") {
      if (!isDateCompatibleCustomFieldValue(value)) {
        skipped.push({
          logicalKey,
          dataType,
          reason: "invalid_date_value",
          message: `Skipped ${logicalKey} — value is not date-compatible for DATE field.`,
          isCoreRequired: isCoreRequiredLogicalKey(logicalKey),
        });
        continue;
      }
      attemptedTextFields.push(logicalKey);
      pushPutItem(
        textBatch,
        { logicalKey, ghlFieldId, ghlFieldKey, value, dataType },
        usedTextIds
      );
      continue;
    }

    if (category === "option") {
      const allowedOptions = extractAllowedOptionsFromDiscoveredField(discovered);
      if (allowedOptions.length === 0) {
        skippedOptionFields.push(logicalKey);
        skipped.push({
          logicalKey,
          dataType,
          reason: "option_field_no_allowed_values",
          message: `Skipped option field ${logicalKey} — allowed options not available for validation.`,
          isCoreRequired: isCoreRequiredLogicalKey(logicalKey),
        });
        continue;
      }
      if (!isValueAllowedForPicklist(value, allowedOptions)) {
        skippedOptionFields.push(logicalKey);
        skipped.push({
          logicalKey,
          dataType,
          reason: "option_value_not_in_allowed_list",
          message: `Skipped option field ${logicalKey} — value does not match discovered dropdown options.`,
          isCoreRequired: isCoreRequiredLogicalKey(logicalKey),
        });
        continue;
      }
      pushPutItem(
        optionBatch,
        { logicalKey, ghlFieldId, ghlFieldKey, value, dataType },
        usedOptionIds
      );
      continue;
    }

    skipped.push({
      logicalKey,
      dataType,
      reason: "unsafe_type_without_metadata",
      message: `Skipped ${logicalKey} — field type ${dataType ?? "unknown"} requires validation metadata.`,
      isCoreRequired: isCoreRequiredLogicalKey(logicalKey),
    });
  }

  const unsatisfiedRequiredCoreFields = skipped
    .filter((s) => s.isCoreRequired)
    .map((s) => s.logicalKey)
    .filter((k): k is Sa360LogicalFieldKey => isCoreRequiredLogicalKey(k));

  return {
    textBatch,
    optionBatch,
    skipped,
    attemptedTextFields,
    skippedOptionFields,
    unsatisfiedRequiredCoreFields,
  };
}

/** Fallback when no discovery metadata — stamp only mapped fields (legacy path). */
export function buildLegacyCustomFieldStampPlan(input: {
  idMap: Record<string, string>;
  values: Record<string, string | null | undefined>;
  keyMap?: Record<string, string>;
}): TypedCustomFieldStampPlan {
  const built = buildCustomFieldsForPutFromMap(input.idMap, input.values, { keyMap: input.keyMap });
  return {
    textBatch: built,
    optionBatch: { apiPayload: [], diagnostics: [] },
    skipped: [],
    attemptedTextFields: built.diagnostics.map((d) => d.logicalKey),
    skippedOptionFields: [],
    unsatisfiedRequiredCoreFields: [],
  };
}

export function formatSkippedOptionFieldsWarning(skipped: SkippedCustomFieldEntry[]): string | null {
  const optionSkips = skipped.filter((s) =>
    s.reason === "option_field_no_allowed_values" || s.reason === "option_value_not_in_allowed_list"
  );
  if (optionSkips.length === 0) return null;
  return `Option fields skipped until dropdown options are mapped/validated: ${optionSkips
    .map((s) => s.logicalKey)
    .join(", ")}.`;
}

export type CustomFieldStampStepResolution = {
  status: "succeeded" | "partial_success" | "optional_failed" | "failed" | "skipped";
  errorSummary: string | null;
  warnings: string[];
};

export function resolveCustomFieldStampStepStatus(input: {
  stampRequired: boolean;
  textAttempted: boolean;
  textOk: boolean;
  optionAttempted: boolean;
  optionOk: boolean;
  textBatchCount: number;
  optionBatchCount: number;
  skipped: SkippedCustomFieldEntry[];
  unsatisfiedRequiredCoreFields: Sa360LogicalFieldKey[];
  textErrorDetail: string | null;
  optionErrorDetail: string | null;
}): CustomFieldStampStepResolution {
  const warnings: string[] = [];
  const skippedWarning = formatSkippedOptionFieldsWarning(input.skipped);
  if (skippedWarning) warnings.push(skippedWarning);

  if (input.textBatchCount === 0 && input.optionBatchCount === 0) {
    if (input.skipped.length === 0) {
      return { status: "skipped", errorSummary: null, warnings };
    }
    if (input.stampRequired && input.unsatisfiedRequiredCoreFields.length > 0) {
      return {
        status: "failed",
        errorSummary: `Required custom fields cannot be safely stamped: ${input.unsatisfiedRequiredCoreFields.join(", ")}.`,
        warnings,
      };
    }
    return {
      status: input.stampRequired ? "optional_failed" : "partial_success",
      errorSummary: skippedWarning,
      warnings,
    };
  }

  if (input.textAttempted && !input.textOk) {
    const status = input.stampRequired ? "failed" : "optional_failed";
    return {
      status,
      errorSummary: input.textErrorDetail ?? "TEXT custom field stamp failed.",
      warnings,
    };
  }

  if (input.optionAttempted && !input.optionOk) {
    if (input.textBatchCount > 0 && input.textOk) {
      return {
        status: input.stampRequired ? "failed" : "partial_success",
        errorSummary: input.optionErrorDetail ?? "Validated option custom field stamp failed.",
        warnings,
      };
    }
    const status = input.stampRequired ? "failed" : "optional_failed";
    return {
      status,
      errorSummary: input.optionErrorDetail ?? "Option custom field stamp failed.",
      warnings,
    };
  }

  const skippedOptionCount = input.skipped.filter(
    (s) =>
      s.reason === "option_field_no_allowed_values" ||
      s.reason === "option_value_not_in_allowed_list"
  ).length;

  if (skippedOptionCount > 0 || input.skipped.some((s) => s.isCoreRequired)) {
    if (input.stampRequired && input.unsatisfiedRequiredCoreFields.length > 0) {
      return {
        status: "failed",
        errorSummary: `Required custom fields cannot be safely stamped: ${input.unsatisfiedRequiredCoreFields.join(", ")}.`,
        warnings,
      };
    }
    if (skippedOptionCount > 0 || input.skipped.length > 0) {
      return {
        status: "partial_success",
        errorSummary: skippedWarning,
        warnings,
      };
    }
  }

  if (input.stampRequired && input.unsatisfiedRequiredCoreFields.length > 0) {
    return {
      status: "failed",
      errorSummary: `Required custom fields cannot be safely stamped: ${input.unsatisfiedRequiredCoreFields.join(", ")}.`,
      warnings,
    };
  }

  return { status: "succeeded", errorSummary: null, warnings };
}
