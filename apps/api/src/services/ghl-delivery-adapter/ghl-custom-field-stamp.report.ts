import type { Sa360FieldMappingAssessment } from "../sa360-custom-field-mapping.service.js";

/** Example GHL_SA360_CUSTOM_FIELD_IDS_JSON shape (logical key → GHL custom field UUID). */
export const GHL_SA360_CUSTOM_FIELD_IDS_JSON_EXAMPLE = {
  sa360_lead_uid: "GHL_FIELD_ID",
  sa360_client_account_id: "GHL_FIELD_ID",
  sa360_lifecycle_stage: "GHL_FIELD_ID",
  sa360_routing_status: "GHL_FIELD_ID",
} as const;

export type CustomFieldStampReport = {
  mappingSource: string;
  envConfigured: boolean;
  logicalKeysToStamp: string[];
  configuredGhlFieldIds: string[];
  mappableKeys: string[];
  unmappedKeys: string[];
  coreRequiredMissing: string[];
  optionalMissing: string[];
  skippedReason: string | null;
};

export function buildCustomFieldStampReport(
  values: Record<string, string | null | undefined>,
  idMap: Record<string, string>,
  mappingAssessment?: Pick<
    Sa360FieldMappingAssessment,
    "source" | "coreRequiredMissing" | "optionalMissing"
  >
): CustomFieldStampReport {
  const logicalKeysToStamp = Object.entries(values)
    .filter(([, v]) => v != null && String(v).trim().length > 0)
    .map(([k]) => k);
  const configuredGhlFieldIds = [...new Set(Object.values(idMap).filter((v) => v.trim()))];
  const envConfigured = configuredGhlFieldIds.length > 0;
  const mappableKeys = logicalKeysToStamp.filter((k) => Boolean(idMap[k]?.trim()));
  const unmappedKeys = logicalKeysToStamp.filter((k) => !idMap[k]?.trim());

  let skippedReason: string | null = null;
  if (!envConfigured) {
    skippedReason =
      "No SA360 custom field ID mapping configured for this destination — custom field stamp skipped (optional unless customFieldStampRequired).";
  } else if (mappableKeys.length === 0) {
    skippedReason =
      "Saved field mapping has no matching keys for this delivery plan — custom field stamp skipped.";
  }

  return {
    mappingSource: mappingAssessment?.source ?? "none",
    envConfigured,
    logicalKeysToStamp,
    configuredGhlFieldIds,
    mappableKeys,
    unmappedKeys,
    coreRequiredMissing: mappingAssessment?.coreRequiredMissing ?? [],
    optionalMissing: mappingAssessment?.optionalMissing ?? [],
    skippedReason,
  };
}

export function formatCustomFieldStampWarning(report: CustomFieldStampReport): string {
  if (!report.skippedReason) return "";
  const parts = [report.skippedReason];
  if (report.mappingSource !== "none") {
    parts.push(`Mapping source: ${report.mappingSource}.`);
  }
  if (report.logicalKeysToStamp.length > 0) {
    parts.push(`Logical keys to stamp: ${report.logicalKeysToStamp.join(", ")}.`);
  }
  if (report.configuredGhlFieldIds.length > 0) {
    parts.push(`Configured GHL field IDs: ${report.configuredGhlFieldIds.length} key(s) in map.`);
  } else {
    parts.push(
      "Save field mapping on the client GHL destination via Config Discovery, or set GHL_SA360_CUSTOM_FIELD_IDS_JSON for demo fallback."
    );
  }
  if (report.coreRequiredMissing.length > 0) {
    parts.push(`Core required unmapped: ${report.coreRequiredMissing.join(", ")}.`);
  }
  if (report.unmappedKeys.length > 0) {
    parts.push(`Unmapped logical keys for this run: ${report.unmappedKeys.join(", ")}.`);
  }
  return parts.join(" ");
}
