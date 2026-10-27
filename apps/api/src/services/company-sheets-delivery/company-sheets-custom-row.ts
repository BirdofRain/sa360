/**
 * Custom campaign row for one saved header snapshot.
 *
 * Cells are emitted in that snapshot's order. Delivery identity columns
 * (delivery_row_id, client_account_id, source_lead_event_id, received_at)
 * are not added to a legacy header. v1/v2/v3 row bytes stay in the campaign
 * mapper. This module only projects those stored fields onto an operator map.
 *
 * Append contract (`CUSTOM_APPEND_CONTRACT`):
 * - values.append / values.update use RAW. USER_ENTERED is refused.
 * - The write is a new row only. Row 1 and every existing data row are not in the range.
 * - A column whose header or row-2 cell begins with "=" is a formula column and is omitted.
 *   Existing formula cells are not written. The new row's formula cell is left absent;
 *   this writer does not copy the formula onto the appended row.
 * - Unmapped and blank-header columns are an empty cell on that new row only.
 * - Columns that appear after the saved snapshot are not written.
 * - A live header that is not an exact match of the snapshot stops before appendStartedAt
 *   with header_changed. That stop is not an uncertain append.
 */

import { createHash } from "node:crypto";

import { COMPANY_SHEETS_V3_COLUMNS } from "@sa360/shared";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "../../lib/company-google-sheets-env.js";
import { companySheetsCampaignRowValues, type CampaignSheetLeadInput } from "./company-sheets-campaign-row.js";

export const COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA = "company_sheets_campaign_custom_v1";

export const CUSTOM_APPEND_CONTRACT = {
  behavior: "new_row_only",
  valueInputOption: "RAW",
  headerRow: "not_rewritten",
  existingRows: "not_rewritten",
  formulaColumns: "omitted_when_header_or_row2_starts_with_equals",
  unmappedColumns: "empty_cell_on_the_new_row_only",
  columnsBeyondSnapshot: "not_written",
  headerDrift: "stop_before_append_with_header_changed",
} as const;

export const HEADER_CHANGED_DETAIL =
  "The worksheet header changed. Delivery stopped before any append. Review the new headers and publish a new map. Existing rows and the header row were not rewritten.";

const FORBIDDEN_SOURCE_FIELDS = new Set([
  "delivery_row_id",
  "client_account_id",
  "source_lead_event_id",
  "received_at",
]);

const REQUIRED_NORMALIZED = new Set([
  "phone",
  "phone number",
  "email",
  "e-mail",
  "client name",
  "full name",
  "name",
]);

export type ColumnTransform = "passthrough" | "trim" | "date_america_new_york" | "blank";
export type ColumnDecision = "mapped" | "unmapped" | "ambiguous";

export type ColumnTarget = { kind: "v3_column"; header: string; sourceField: string };

export type ColumnAssignment = {
  sheetHeader: string;
  columnIndex: number;
  formula: boolean;
  target: ColumnTarget | null;
  transform: ColumnTransform;
  decision: ColumnDecision;
  explicit: boolean;
  code: string | null;
};

export type ColumnMapIssue = {
  columnIndex: number;
  sheetHeader: string;
  code: string;
  message: string;
};

export type MappableTarget = { header: string; sourceField: string };

type LeadRecord = { routingResultJson?: unknown; enrichmentMetadataJson?: unknown };

const TRANSFORMS = new Set<ColumnTransform>(["passthrough", "trim", "date_america_new_york", "blank"]);
const DECISIONS = new Set<ColumnDecision>(["mapped", "unmapped", "ambiguous"]);

export function mappableColumnTargets(): MappableTarget[] {
  return COMPANY_SHEETS_V3_COLUMNS.filter((column) => !FORBIDDEN_SOURCE_FIELDS.has(column.sourceField)).map(
    (column) => ({ header: column.header, sourceField: column.sourceField })
  );
}

export function headerFingerprint(header: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([...header])).digest("hex");
}

export function normalizeSheetHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
}

export function exactHeader(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((cell, index) => actual[index] === cell);
}

export function formulaColumnIndexes(header: readonly string[], sampleRow: readonly string[]): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < header.length; index += 1) {
    const headerCell = header[index] ?? "";
    const sample = sampleRow[index] ?? "";
    if (headerCell.trim().startsWith("=") || sample.trim().startsWith("=")) indexes.push(index);
  }
  return indexes;
}

export function columnLabel(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function customAppendSegments(
  values: readonly string[],
  formulaIndexes: readonly number[]
): Array<{ startIndex: number; values: string[] }> {
  const skip = new Set(formulaIndexes);
  const segments: Array<{ startIndex: number; values: string[] }> = [];
  let current: { startIndex: number; values: string[] } | null = null;
  for (let index = 0; index < values.length; index += 1) {
    if (skip.has(index)) {
      current = null;
      continue;
    }
    if (!current) {
      current = { startIndex: index, values: [] };
      segments.push(current);
    }
    current.values.push(values[index] ?? "");
  }
  return segments;
}

export function appendedRowNumber(updatedRange: string | null | undefined): number | null {
  if (!updatedRange) return null;
  const match = /!\$?[A-Z]+\$?(\d+)/i.exec(updatedRange);
  if (!match) return null;
  const row = Number(match[1]);
  return Number.isInteger(row) && row >= 2 ? row : null;
}

export function formatDateAmericaNewYork(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoDay) return `${isoDay[2]}/${isoDay[3]}/${isoDay[1]}`;
  const usDay = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (usDay) return `${usDay[1].padStart(2, "0")}/${usDay[2].padStart(2, "0")}/${usDay[3]}`;
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) && !value.includes("T")) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const year = parts.find((part) => part.type === "year")?.value;
  if (!month || !day || !year) return "";
  return `${month}/${day}/${year}`;
}

export function sourceFunnelIdFromLead(lead: LeadRecord): string | null {
  const routing = asRecord(lead.routingResultJson);
  const association = asRecord(routing?.sourceAssociation);
  if (typeof association?.sourceFunnelId === "string" && association.sourceFunnelId.trim()) {
    return association.sourceFunnelId.trim();
  }
  const enrichment = asRecord(lead.enrichmentMetadataJson);
  const nested = asRecord(enrichment?.association);
  if (typeof nested?.sourceFunnelId === "string" && nested.sourceFunnelId.trim()) return nested.sourceFunnelId.trim();
  return null;
}

export function suggestColumnAssignments(header: readonly string[], sampleRow: readonly string[] = []): ColumnAssignment[] {
  const formulas = new Set(formulaColumnIndexes(header, sampleRow));
  const normalized = header.map((cell) => normalizeSheetHeader(cell));
  const counts = new Map<string, number>();
  for (const key of normalized) {
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return header.map((sheetHeader, columnIndex) => {
    const key = normalized[columnIndex] ?? "";
    const formula = formulas.has(columnIndex);
    if (!key) {
      return assignment({ sheetHeader, columnIndex, formula, target: null, transform: "blank", decision: "unmapped", explicit: false, code: "blank_header" });
    }
    if ((counts.get(key) ?? 0) > 1) {
      return assignment({ sheetHeader, columnIndex, formula, target: null, transform: "blank", decision: "ambiguous", explicit: false, code: "duplicate_header" });
    }
    if (key === "age/dob") {
      return assignment({ sheetHeader, columnIndex, formula, target: null, transform: "blank", decision: "ambiguous", explicit: false, code: "ambiguous_age_or_dob" });
    }
    const target = targetForNormalized(key);
    if (!target) {
      return assignment({ sheetHeader, columnIndex, formula, target: null, transform: "blank", decision: "unmapped", explicit: false, code: formula ? "formula_column_omitted" : null });
    }
    return assignment({
      sheetHeader,
      columnIndex,
      formula,
      target: target.target,
      transform: target.transform,
      decision: "mapped",
      explicit: false,
      code: formula ? "formula_column_omitted" : null,
    });
  });
}

export function columnMapIssues(columns: readonly ColumnAssignment[]): ColumnMapIssue[] {
  const issues: ColumnMapIssue[] = [];
  for (const column of columns) {
    if (column.code === "blank_header") {
      issues.push(issue(column, "blank_header", "This header is blank. Leave it unmapped. It is not a lead field."));
    } else if (column.code === "duplicate_header" || (column.decision === "ambiguous" && column.code === "duplicate_header")) {
      issues.push(issue(column, "duplicate_header", "This header is duplicated. Map one column explicitly and leave the other unmapped, or choose different fields."));
    } else if (column.code === "ambiguous_age_or_dob" || (column.decision === "ambiguous" && normalizeSheetHeader(column.sheetHeader) === "age/dob")) {
      issues.push(issue(column, "ambiguous_age_or_dob", "Age/DOB is ambiguous. Choose Age, DOB, or leave it blank. Age is not calculated from DOB."));
    } else if (!column.explicit) {
      issues.push(issue(column, "mapping_unresolved", "Confirm this suggestion or mark the column unmapped."));
    } else if (column.decision === "ambiguous") {
      issues.push(issue(column, column.code ?? "mapping_unresolved", "This column is still ambiguous."));
    }
    if (column.formula) {
      issues.push(issue(column, "formula_column_omitted", "This column has a formula. Appends skip it so the formula and existing rows stay intact."));
    }
    if (column.explicit && column.decision === "unmapped" && REQUIRED_NORMALIZED.has(normalizeSheetHeader(column.sheetHeader))) {
      issues.push(issue(column, "required_field_unmapped", "Phone, email, and name columns must be mapped before publish."));
    }
  }
  return issues;
}

export function applyOperatorAssignments(
  header: readonly string[],
  sampleRow: readonly string[],
  input: unknown
): { ok: true; assignments: ColumnAssignment[] } | { ok: false; statusCode: number; error: string; detail?: string } {
  if (!Array.isArray(input) || input.length !== header.length) {
    return { ok: false, statusCode: 422, error: "mapping_unresolved", detail: "Assignments must cover every header column." };
  }
  const formulas = new Set(formulaColumnIndexes(header, sampleRow));
  const assignments: ColumnAssignment[] = [];
  for (let index = 0; index < header.length; index += 1) {
    const parsed = parseOperatorColumn(input[index], header[index] ?? "", index, formulas.has(index));
    if (!parsed.ok) return parsed;
    assignments.push(parsed.assignment);
  }
  const seen = new Map<string, number>();
  for (const column of assignments) {
    if (column.decision !== "mapped" || !column.target) continue;
    const prior = seen.get(column.target.sourceField);
    if (prior != null) {
      return {
        ok: false,
        statusCode: 422,
        error: "duplicate_target",
        detail: `Columns ${prior + 1} and ${column.columnIndex + 1} both map to ${column.target.header}.`,
      };
    }
    seen.set(column.target.sourceField, column.columnIndex);
  }
  return { ok: true, assignments };
}

export function publishBlocker(
  assignments: readonly ColumnAssignment[]
): { ok: true } | { ok: false; statusCode: number; error: string; detail?: string } {
  if (assignments.some((column) => !column.explicit || column.decision === "ambiguous")) {
    const age = assignments.find((column) => column.decision === "ambiguous" && column.code === "ambiguous_age_or_dob");
    return {
      ok: false,
      statusCode: 422,
      error: age ? "mapping_unresolved" : "mapping_unresolved",
      detail: age
        ? "Age/DOB is still unresolved. Choose Age, DOB, or blank."
        : "Every column needs an explicit mapped or unmapped decision.",
    };
  }
  const required = assignments.find(
    (column) => column.decision === "unmapped" && REQUIRED_NORMALIZED.has(normalizeSheetHeader(column.sheetHeader))
  );
  if (required) {
    return {
      ok: false,
      statusCode: 422,
      error: "required_field_unmapped",
      detail: `${required.sheetHeader} must be mapped before publish.`,
    };
  }
  if (!assignments.some((column) => column.decision === "mapped")) {
    return { ok: false, statusCode: 422, error: "mapping_unresolved", detail: "Map at least one column before publish." };
  }
  return { ok: true };
}

export function customRowValues(
  assignments: readonly ColumnAssignment[],
  lead: CampaignSheetLeadInput
): string[] | null {
  const v3 = companySheetsCampaignRowValues({ ...lead, schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 });
  if (!v3) return null;
  const byField = new Map(COMPANY_SHEETS_V3_COLUMNS.map((column, index) => [column.sourceField, v3[index] ?? ""]));
  return assignments.map((column) => {
    if (column.decision !== "mapped" || !column.target || column.transform === "blank") return "";
    let value = byField.get(column.target.sourceField) ?? "";
    if (column.transform === "trim") value = value.trim();
    if (column.transform === "date_america_new_york") value = formatDateAmericaNewYork(value);
    return value;
  });
}

export function syntheticCustomCampaignLead(input: {
  stableRowId: string;
  clientAccountId: string;
  spreadsheetId: string;
  worksheetTitle: string;
}): CampaignSheetLeadInput {
  return {
    stableRowId: input.stableRowId,
    clientAccountId: input.clientAccountId,
    sourceLeadEventId: "synthetic-campaign-test",
    receivedAt: "2026-10-26T15:00:00.000Z",
    sourceLeadId: null,
    normalizedPayload: {
      contact: {
        first_name: "SYNTHETIC",
        last_name: `TEST ${input.spreadsheetId} ${input.worksheetTitle}`,
        email: "synthetic@example.invalid",
        state: "NA",
        date_of_birth: "1990-04-02",
      },
      phone: "SYNTHETIC",
      state: { lead_type: "SYNTHETIC" },
      routing: {
        source_intake: {
          lead_id: "synthetic-sheets-test",
          source_lead_id_generated: true,
          submitted_at: "2026-10-26T14:00:00.000Z",
          unmappedSourceFieldsJson: [
            {
              key: "notes",
              value: `Controlled writer test for spreadsheet ${input.spreadsheetId} tab ${input.worksheetTitle}. Not an inventory lead.`,
            },
          ],
        },
      },
    },
  };
}

export function isCustomSheetsWriterEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED?.trim() === "true";
}

export function columnMapContentKey(mapId: string, mapVersion: number): string {
  return `column-map:${mapId}:v${mapVersion}`;
}

function targetForNormalized(key: string): { target: ColumnTarget; transform: ColumnTransform } | null {
  const direct = mappableColumnTargets().find((column) => normalizeSheetHeader(column.header) === key);
  if (direct) {
    return {
      target: { kind: "v3_column", header: direct.header, sourceField: direct.sourceField },
      transform: direct.sourceField === "date_of_birth" ? "date_america_new_york" : "passthrough",
    };
  }
  const aliases: Record<string, { header: string; sourceField: string; transform: ColumnTransform }> = {
    "full name": { header: "Client Name", sourceField: "full_name", transform: "passthrough" },
    name: { header: "Client Name", sourceField: "full_name", transform: "passthrough" },
    "phone number": { header: "Phone", sourceField: "phone", transform: "passthrough" },
    "e-mail": { header: "Email", sourceField: "email", transform: "passthrough" },
    dob: { header: "DOB", sourceField: "date_of_birth", transform: "date_america_new_york" },
    "date of birth": { header: "DOB", sourceField: "date_of_birth", transform: "date_america_new_york" },
  };
  const alias = aliases[key];
  if (!alias) return null;
  return { target: { kind: "v3_column", header: alias.header, sourceField: alias.sourceField }, transform: alias.transform };
}

function knownTarget(header: string, sourceField: string): ColumnTarget | null {
  const match = mappableColumnTargets().find((column) => column.header === header && column.sourceField === sourceField);
  if (!match) return null;
  return { kind: "v3_column", header: match.header, sourceField: match.sourceField };
}

function parseOperatorColumn(
  value: unknown,
  sheetHeader: string,
  columnIndex: number,
  formula: boolean
): { ok: true; assignment: ColumnAssignment } | { ok: false; statusCode: number; error: string; detail?: string } {
  const record = asRecord(value);
  if (!record || record.sheetHeader !== sheetHeader) {
    return { ok: false, statusCode: 422, error: "mapping_unresolved", detail: `Column ${columnIndex + 1} does not match the saved header.` };
  }
  if (!DECISIONS.has(record.decision as ColumnDecision) || !TRANSFORMS.has(record.transform as ColumnTransform)) {
    return { ok: false, statusCode: 422, error: "mapping_unresolved", detail: `Column ${columnIndex + 1} has an unknown decision.` };
  }
  const decision = record.decision as ColumnDecision;
  const transform = record.transform as ColumnTransform;
  const explicit = record.explicit === true;
  const normalized = normalizeSheetHeader(sheetHeader);
  if (!sheetHeader.trim()) {
    if (decision !== "unmapped" || transform !== "blank") {
      return { ok: false, statusCode: 422, error: "blank_header", detail: "A blank header cannot be mapped." };
    }
    return { ok: true, assignment: assignment({ sheetHeader, columnIndex, formula, target: null, transform: "blank", decision: "unmapped", explicit, code: "blank_header" }) };
  }
  if (decision === "unmapped" || decision === "ambiguous") {
    if (decision === "unmapped" && transform !== "blank") {
      return { ok: false, statusCode: 422, error: "mapping_unresolved", detail: "An unmapped column uses a blank transform." };
    }
    const code = normalized === "age/dob" && decision === "ambiguous" ? "ambiguous_age_or_dob" : decision === "ambiguous" ? "duplicate_header" : formula ? "formula_column_omitted" : null;
    return {
      ok: true,
      assignment: assignment({ sheetHeader, columnIndex, formula, target: null, transform: decision === "unmapped" ? "blank" : transform, decision, explicit, code }),
    };
  }
  const targetRecord = asRecord(record.target);
  const target = targetRecord ? knownTarget(String(targetRecord.header ?? ""), String(targetRecord.sourceField ?? "")) : null;
  if (!target || targetRecord?.kind !== "v3_column") {
    return { ok: false, statusCode: 422, error: "unknown_target", detail: `Column ${columnIndex + 1} is not a v3 lead field.` };
  }
  if (normalized === "primary reason" && target.sourceField !== "primary_reason") {
    return { ok: false, statusCode: 422, error: "primary_reason_is_not_primary_concern", detail: "Primary Reason cannot be copied into Primary Concern." };
  }
  if (normalized === "primary concern" && target.sourceField !== "primary_concern") {
    return { ok: false, statusCode: 422, error: "primary_reason_is_not_primary_concern", detail: "Primary Concern stays separate from Primary Reason." };
  }
  if (normalized === "age/dob") {
    const age = target.sourceField === "consumer_age" && transform === "passthrough";
    const dob = target.sourceField === "date_of_birth" && transform === "date_america_new_york";
    if (!age && !dob) {
      return { ok: false, statusCode: 422, error: "ambiguous_age_or_dob", detail: "Choose Age, DOB, or leave Age/DOB blank." };
    }
  }
  if (target.sourceField === "submitted_at" && transform === "date_america_new_york") {
    return { ok: false, statusCode: 422, error: "unknown_target", detail: "The Date column keeps the generation timestamp. It does not use the legacy date transform." };
  }
  return {
    ok: true,
    assignment: assignment({
      sheetHeader,
      columnIndex,
      formula,
      target,
      transform,
      decision: "mapped",
      explicit,
      code: formula ? "formula_column_omitted" : null,
    }),
  };
}

function assignment(input: ColumnAssignment): ColumnAssignment {
  return input;
}

function issue(column: ColumnAssignment, code: string, message: string): ColumnMapIssue {
  return { columnIndex: column.columnIndex, sheetHeader: column.sheetHeader, code, message };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
