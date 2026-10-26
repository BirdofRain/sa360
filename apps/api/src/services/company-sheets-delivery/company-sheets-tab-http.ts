import { GOOGLE_SHEETS_HTTP_TIMEOUT_MS, GOOGLE_SHEETS_SPREADSHEETS_URL } from "../../lib/google-sheets-env.js";
import type { GoogleSheetsHttpFailure } from "../google-sheets/google-sheets-http-client.js";

type FetchLike = typeof fetch;

function assertBatchUpdateUrl(url: string): void {
  if (!url.startsWith(`${GOOGLE_SHEETS_SPREADSHEETS_URL}/`) || !url.endsWith(":batchUpdate")) {
    throw new Error("Sheets tab client refused a non-batchUpdate URL.");
  }
  if (url.includes("drive.googleapis.com") || url.includes("permissions") || url.includes("USER_ENTERED")) {
    throw new Error("Sheets tab client refused a non-tab request.");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function classify(status: number): GoogleSheetsHttpFailure {
  if (status === 401) return "unauthorized";
  if (status === 403) return "access_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status === 400) return "invalid_request";
  return "malformed_response";
}

export type AddedSheet = { worksheetId: number; worksheetTitle: string };

/**
 * Adds one worksheet. Callers must already have proven the title is absent.
 * A timeout does not mean the tab is missing, and this function does not retry.
 */
export async function addSpreadsheetSheet(
  input: { spreadsheetId: string; title: string; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; sheet: AddedSheet } | { ok: false; reason: GoogleSheetsHttpFailure }> {
  const url = `${GOOGLE_SHEETS_SPREADSHEETS_URL}/${encodeURIComponent(input.spreadsheetId)}:batchUpdate`;
  assertBatchUpdateUrl(url);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: input.title } } }],
      }),
      signal: AbortSignal.timeout(GOOGLE_SHEETS_HTTP_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  if (!response.ok) return { ok: false, reason: classify(response.status) };
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, reason: "malformed_response" };
  }
  const replies = asRecord(json)?.replies;
  const properties = asRecord(asRecord(Array.isArray(replies) ? replies[0] : null)?.addSheet)?.properties;
  const sheetId = asRecord(properties)?.sheetId;
  const title = asRecord(properties)?.title;
  if (typeof sheetId !== "number" || !Number.isInteger(sheetId) || sheetId < 0) {
    return { ok: false, reason: "malformed_response" };
  }
  if (typeof title !== "string" || title.trim() !== input.title) {
    return { ok: false, reason: "malformed_response" };
  }
  return { ok: true, sheet: { worksheetId: sheetId, worksheetTitle: title.trim() } };
}

/**
 * Formats a header row that is already present. This does not write cell values.
 * frozenRowCount and bold are idempotent, so a retry does not append another header.
 */
export async function formatSheetHeaderRow(
  input: { spreadsheetId: string; worksheetId: number; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true } | { ok: false; reason: GoogleSheetsHttpFailure }> {
  const url = `${GOOGLE_SHEETS_SPREADSHEETS_URL}/${encodeURIComponent(input.spreadsheetId)}:batchUpdate`;
  assertBatchUpdateUrl(url);
  if (!Number.isInteger(input.worksheetId) || input.worksheetId < 0) {
    return { ok: false, reason: "invalid_request" };
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: input.worksheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            repeatCell: {
              range: { sheetId: input.worksheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true },
                  backgroundColor: { red: 0.9, green: 0.94, blue: 0.98 },
                },
              },
              fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor",
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(GOOGLE_SHEETS_HTTP_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  if (!response.ok) return { ok: false, reason: classify(response.status) };
  return { ok: true };
}
