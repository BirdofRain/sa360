import { GOOGLE_SHEETS_HTTP_TIMEOUT_MS, GOOGLE_SHEETS_SPREADSHEETS_URL } from "../../lib/google-sheets-env.js";
import type { GoogleSheetsHttpFailure } from "../google-sheets/google-sheets-http-client.js";

type FetchLike = typeof fetch;

export function quoteSheetTitle(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}

function assertValuesUrl(url: string): void {
  if (!url.startsWith(`${GOOGLE_SHEETS_SPREADSHEETS_URL}/`)) {
    throw new Error("Sheets values client refused a non-Sheets URL.");
  }
  if (url.includes("drive.googleapis.com")) {
    throw new Error("Sheets values client refused a Drive URL.");
  }
  if (url.includes("valueInputOption=USER_ENTERED")) {
    throw new Error("Sheets values client refused formula interpretation.");
  }
}

async function boundedFetch(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  assertValuesUrl(url);
  return fetchImpl(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(GOOGLE_SHEETS_HTTP_TIMEOUT_MS),
  });
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseSheetValues(json: unknown): string[][] {
  const record = asRecord(json);
  const rows = record?.values;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => (Array.isArray(row) ? row.map((cell) => (cell == null ? "" : String(cell))) : []));
}

async function readBody(response: Response): Promise<{ ok: true; json: unknown } | { ok: false }> {
  try {
    return { ok: true, json: await response.json() };
  } catch {
    return { ok: false };
  }
}

export async function getSheetValues(
  input: { spreadsheetId: string; range: string; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; values: string[][] } | { ok: false; reason: GoogleSheetsHttpFailure }> {
  const url = `${GOOGLE_SHEETS_SPREADSHEETS_URL}/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.range)}`;
  let response: Response;
  try {
    response = await boundedFetch(fetchImpl, url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${input.accessToken}` },
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  if (response.status === 200) {
    const parsed = await readBody(response);
    if (!parsed.ok) return { ok: false, reason: "malformed_response" };
    return { ok: true, values: parseSheetValues(parsed.json) };
  }
  if (!response.ok) return { ok: false, reason: classify(response.status) };
  return { ok: false, reason: "malformed_response" };
}

export async function updateSheetValues(
  input: { spreadsheetId: string; range: string; values: string[][]; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; updatedRange?: string | null } | { ok: false; reason: GoogleSheetsHttpFailure }> {
  const url = `${GOOGLE_SHEETS_SPREADSHEETS_URL}/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.range)}?valueInputOption=RAW`;
  return writeValues(url, "PUT", input.values, input.accessToken, fetchImpl);
}

export async function appendSheetValues(
  input: { spreadsheetId: string; range: string; values: string[][]; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; updatedRange?: string | null } | { ok: false; reason: GoogleSheetsHttpFailure }> {
  const url = `${GOOGLE_SHEETS_SPREADSHEETS_URL}/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  return writeValues(url, "POST", input.values, input.accessToken, fetchImpl);
}

async function writeValues(
  url: string,
  method: "PUT" | "POST",
  values: string[][],
  accessToken: string,
  fetchImpl: FetchLike
): Promise<{ ok: true; updatedRange?: string | null } | { ok: false; reason: GoogleSheetsHttpFailure }> {
  let response: Response;
  try {
    response = await boundedFetch(fetchImpl, url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values, majorDimension: "ROWS" }),
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  if (response.ok) {
    const parsed = await readBody(response);
    const record = parsed.ok ? asRecord(parsed.json) : null;
    const updates = asRecord(record?.updates);
    const updatedRange = typeof updates?.updatedRange === "string" ? updates.updatedRange : null;
    return { ok: true, updatedRange };
  }
  return { ok: false, reason: classify(response.status) };
}
