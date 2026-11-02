import type {
  StoredLeadColumnPreview,
  StoredLeadColumnPreviewCell,
  StoredLeadPreviewLead,
  StoredLeadPreviewList,
} from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function projectLead(value: unknown): StoredLeadPreviewLead | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || typeof record.label !== "string") return null;
  if (typeof record.receivedAt !== "string" || typeof record.sourceProvider !== "string") return null;
  if (typeof record.sourceSystem !== "string" || typeof record.sourceType !== "string") return null;
  return {
    id: record.id,
    receivedAt: record.receivedAt,
    sourceProvider: record.sourceProvider,
    sourceSystem: record.sourceSystem,
    sourceType: record.sourceType,
    label: record.label,
  };
}

function projectCell(value: unknown): StoredLeadColumnPreviewCell | null {
  const record = asRecord(value);
  if (!record || typeof record.columnLetter !== "string" || typeof record.position !== "number") return null;
  if (typeof record.sheetHeader !== "string" || typeof record.formattedValue !== "string") return null;
  if (typeof record.appended !== "boolean") return null;
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.flatMap((item) => {
        const warning = asRecord(item);
        if (!warning || typeof warning.code !== "string" || typeof warning.message !== "string") return [];
        return [{ code: warning.code, message: warning.message }];
      })
    : [];
  return {
    columnLetter: record.columnLetter,
    position: record.position,
    sheetHeader: record.sheetHeader,
    sourceField: typeof record.sourceField === "string" ? record.sourceField : null,
    sourceHeader: typeof record.sourceHeader === "string" ? record.sourceHeader : null,
    formattedValue: record.formattedValue,
    appended: record.appended,
    warnings,
  };
}

/** Copies the preview contract and drops payloads, raw contact JSON, and unknown fields. */
export function projectStoredLeadPreviewList(value: unknown): StoredLeadPreviewList | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.leads)) return null;
  if (record.nextCursor != null && typeof record.nextCursor !== "string") return null;
  const leads = record.leads.flatMap((item) => {
    const lead = projectLead(item);
    return lead ? [lead] : [];
  });
  if (leads.length !== record.leads.length) return null;
  return { leads, nextCursor: typeof record.nextCursor === "string" ? record.nextCursor : null };
}

export function projectStoredLeadColumnPreview(value: unknown): StoredLeadColumnPreview | null {
  const record = asRecord(value);
  if (!record || record.previewOnly !== true || record.deliveryReady !== false) return null;
  if (record.presentAsDeliveryReady !== false || record.googleHeaderIndependentlyReread !== false) return null;
  if (record.writes !== false || record.persisted !== false || record.publishedMapUnchanged !== true) return null;
  if (record.basis !== "draft" && record.basis !== "published") return null;
  const external = asRecord(record.externalCalls);
  if (!external || external.sheets !== false || external.ghl !== false) return null;
  const map = asRecord(record.map);
  const lead = projectLead(record.lead);
  if (!map || !lead || typeof map.id !== "string" || typeof map.revision !== "number") return null;
  if (typeof map.spreadsheetId !== "string" || typeof map.worksheetId !== "number") return null;
  if (!Array.isArray(record.columns) || !Array.isArray(record.reasons)) return null;
  const columns = record.columns.flatMap((item) => {
    const cell = projectCell(item);
    return cell ? [cell] : [];
  });
  if (columns.length !== record.columns.length) return null;
  const operatorDecisions = Array.isArray(record.operatorDecisions)
    ? record.operatorDecisions.flatMap((item) => {
        const decision = asRecord(item);
        if (!decision || typeof decision.code !== "string" || typeof decision.message !== "string") return [];
        return [{ code: decision.code, message: decision.message }];
      })
    : [];
  return {
    previewOnly: true,
    deliveryReady: false,
    presentAsDeliveryReady: false,
    googleHeaderIndependentlyReread: false,
    writes: false,
    persisted: false,
    externalCalls: { sheets: false, ghl: false },
    basis: record.basis,
    publishedMapUnchanged: true,
    reasons: stringList(record.reasons),
    map: {
      id: map.id,
      status: typeof map.status === "string" ? map.status : "",
      revision: map.revision,
      spreadsheetId: map.spreadsheetId,
      worksheetId: map.worksheetId,
      headerFingerprint: typeof map.headerFingerprint === "string" ? map.headerFingerprint : "",
      headerFingerprintMatchesBinding: map.headerFingerprintMatchesBinding === true,
    },
    lead,
    columns,
    operatorDecisions,
  };
}
