import { formatSheetHeaderRow } from "./company-sheets-tab-http.js";
import { appendSheetValues, getSheetValues, quoteSheetTitle } from "./company-sheets-values-http.js";

type FetchLike = typeof fetch;
type ReadValues = typeof getSheetValues;
type AppendValues = typeof appendSheetValues;

export type HeaderProvisionResult =
  | { ok: true; headerWritten: boolean; formattingApplied: boolean }
  | { ok: false; code: "create_outcome_unknown" | "header_conflict" };

/**
 * Writes a header on a sheet that has just been created and is still empty.
 * Uses values.append, never values.update. A populated sheet is left unchanged.
 * A successful append is confirmed by reading row 1. A failed confirmation does
 * not append again. An ambiguous append is read once and is not repeated.
 */
export async function provisionBlankSheetHeader(
  input: {
    spreadsheetId: string;
    worksheetTitle: string;
    worksheetId: number;
    header: readonly string[];
    accessToken: string;
    getValues?: ReadValues;
    appendValues?: AppendValues;
    formatHeader?: typeof formatSheetHeaderRow;
    fetchImpl?: FetchLike;
  }
): Promise<HeaderProvisionResult> {
  const read = input.getValues ?? getSheetValues;
  const append = input.appendValues ?? appendSheetValues;
  const format = input.formatHeader ?? formatSheetHeaderRow;
  const range = `${quoteSheetTitle(input.worksheetTitle)}!1:1`;
  const first = await read(
    { spreadsheetId: input.spreadsheetId, range, accessToken: input.accessToken },
    input.fetchImpl
  );
  if (!first.ok) return { ok: false, code: "create_outcome_unknown" };
  if (!isBlank(first.values)) {
    if (!headerMatches(first.values[0] ?? [], input.header)) return { ok: false, code: "header_conflict" };
    const formatting = await format(
      { spreadsheetId: input.spreadsheetId, worksheetId: input.worksheetId, accessToken: input.accessToken },
      input.fetchImpl
    );
    return { ok: true, headerWritten: false, formattingApplied: formatting.ok };
  }
  const appended = await append(
    { spreadsheetId: input.spreadsheetId, range, values: [[...input.header]], accessToken: input.accessToken },
    input.fetchImpl
  );
  if (!appended.ok) {
    if (!isAmbiguous(appended.reason)) return { ok: false, code: "create_outcome_unknown" };
  }
  const confirmed = await read(
    { spreadsheetId: input.spreadsheetId, range, accessToken: input.accessToken },
    input.fetchImpl
  );
  if (!confirmed.ok || !headerMatches(confirmed.values[0] ?? [], input.header)) {
    return { ok: false, code: "create_outcome_unknown" };
  }
  const formatting = await format(
    { spreadsheetId: input.spreadsheetId, worksheetId: input.worksheetId, accessToken: input.accessToken },
    input.fetchImpl
  );
  return { ok: true, headerWritten: true, formattingApplied: formatting.ok };
}

function isBlank(values: string[][]): boolean {
  return values.every((row) => row.every((cell) => cell.trim() === ""));
}

function headerMatches(actual: string[], expected: readonly string[]): boolean {
  if (actual.length < expected.length) return false;
  return expected.every((cell, index) => (actual[index] ?? "") === cell);
}

function isAmbiguous(reason: string): boolean {
  return reason === "network_error" || reason === "server_error" || reason === "malformed_response";
}
