/** Example GHL_SA360_CUSTOM_FIELD_IDS_JSON shape (logical key → GHL custom field UUID). */
export const GHL_SA360_CUSTOM_FIELD_IDS_JSON_EXAMPLE = {
  sa360_lead_uid: "GHL_FIELD_ID",
  sa360_client_account_id: "GHL_FIELD_ID",
  sa360_lifecycle_stage: "GHL_FIELD_ID",
  sa360_routing_status: "GHL_FIELD_ID",
} as const;

export type CustomFieldStampReport = {
  envConfigured: boolean;
  logicalKeysToStamp: string[];
  configuredGhlFieldIds: string[];
  mappableKeys: string[];
  unmappedKeys: string[];
  skippedReason: string | null;
};

export function buildCustomFieldStampReport(
  values: Record<string, string | null | undefined>,
  idMap: Record<string, string>
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
      "GHL_SA360_CUSTOM_FIELD_IDS_JSON is missing or empty — custom field stamp skipped (optional for live canary).";
  } else if (mappableKeys.length === 0) {
    skippedReason =
      "GHL_SA360_CUSTOM_FIELD_IDS_JSON has no matching keys for this delivery plan — custom field stamp skipped.";
  }

  return {
    envConfigured,
    logicalKeysToStamp,
    configuredGhlFieldIds,
    mappableKeys,
    unmappedKeys,
    skippedReason,
  };
}

export function formatCustomFieldStampWarning(report: CustomFieldStampReport): string {
  if (!report.skippedReason) return "";
  const parts = [report.skippedReason];
  if (report.logicalKeysToStamp.length > 0) {
    parts.push(`Logical keys to stamp: ${report.logicalKeysToStamp.join(", ")}.`);
  }
  if (report.configuredGhlFieldIds.length > 0) {
    parts.push(`Configured GHL field IDs: ${report.configuredGhlFieldIds.length} key(s) in env map.`);
  } else {
    parts.push(
      'Set GHL_SA360_CUSTOM_FIELD_IDS_JSON, e.g. {"sa360_lead_uid":"<uuid>","sa360_routing_status":"<uuid>"}.'
    );
  }
  if (report.unmappedKeys.length > 0) {
    parts.push(`Unmapped logical keys: ${report.unmappedKeys.join(", ")}.`);
  }
  return parts.join(" ");
}
