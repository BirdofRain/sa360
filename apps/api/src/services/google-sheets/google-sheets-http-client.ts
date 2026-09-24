import {
  GOOGLE_SHEETS_HTTP_TIMEOUT_MS,
  GOOGLE_SHEETS_SPREADSHEETS_URL,
  isSafeGoogleSpreadsheetUrl,
} from "../../lib/google-sheets-env.js";

export type GoogleSheetsHttpFailure =
  | "unauthorized"
  | "access_denied"
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "malformed_response";

export type GoogleSheetsWorksheet = {
  sheetId: number;
  title: string;
  index: number;
  hidden: boolean;
  sheetType: string;
};

export type GoogleSpreadsheetMetadata = {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  worksheets: GoogleSheetsWorksheet[];
};

type FetchLike = typeof fetch;

const METADATA_FIELDS =
  "spreadsheetId,properties.title,spreadsheetUrl,sheets.properties(sheetId,title,index,hidden,sheetType)";

async function boundedFetch(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit
): Promise<Response> {
  return fetchImpl(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(GOOGLE_SHEETS_HTTP_TIMEOUT_MS),
  });
}

function classifySheetsFailure(status: number): GoogleSheetsHttpFailure {
  if (status === 401) return "unauthorized";
  if (status === 403) return "access_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  // A 400 means Google rejected the request we built, not that the spreadsheet
  // is absent. Keep it distinct so callers do not report a missing spreadsheet.
  if (status === 400) return "invalid_request";
  return "malformed_response";
}

function assertSheetsApiUrl(url: string): void {
  if (!url.startsWith(`${GOOGLE_SHEETS_SPREADSHEETS_URL}`)) {
    throw new Error("Google Sheets client refused a non-Sheets URL.");
  }
  if (url.includes("drive.googleapis.com")) {
    throw new Error("Google Sheets client refused a Drive URL.");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseWorksheet(value: unknown): GoogleSheetsWorksheet | null {
  const sheet = asRecord(value);
  const properties = asRecord(sheet?.properties) ?? sheet;
  if (!properties) return null;
  const sheetId = properties.sheetId;
  const title = typeof properties.title === "string" ? properties.title.trim() : "";
  const index = properties.index;
  if (typeof sheetId !== "number" || !Number.isInteger(sheetId) || sheetId < 0) return null;
  if (!title) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
  return {
    sheetId,
    title,
    index,
    hidden: properties.hidden === true,
    sheetType: typeof properties.sheetType === "string" && properties.sheetType.trim()
      ? properties.sheetType.trim()
      : "GRID",
  };
}

export function parseSpreadsheetMetadata(
  json: unknown,
  expectedSpreadsheetId?: string
): GoogleSpreadsheetMetadata | null {
  const record = asRecord(json);
  if (!record) return null;
  const spreadsheetId =
    typeof record.spreadsheetId === "string" ? record.spreadsheetId.trim() : "";
  if (!spreadsheetId) return null;
  if (expectedSpreadsheetId && spreadsheetId !== expectedSpreadsheetId) return null;
  const properties = asRecord(record.properties);
  const title =
    typeof properties?.title === "string" && properties.title.trim()
      ? properties.title.trim()
      : "";
  if (!title) return null;
  const sheets = Array.isArray(record.sheets) ? record.sheets : [];
  const worksheets = sheets
    .map((sheet) => parseWorksheet(sheet))
    .filter((row): row is GoogleSheetsWorksheet => row !== null);
  const rawUrl = typeof record.spreadsheetUrl === "string" ? record.spreadsheetUrl.trim() : "";
  const spreadsheetUrl = isSafeGoogleSpreadsheetUrl(rawUrl, spreadsheetId)
    ? rawUrl.split("#")[0] ?? rawUrl
    : `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  return { spreadsheetId, title, spreadsheetUrl, worksheets };
}

async function readJson(
  response: Response
): Promise<{ ok: true; json: unknown } | { ok: false; reason: GoogleSheetsHttpFailure }> {
  try {
    return { ok: true, json: await response.json() };
  } catch {
    return { ok: false, reason: "malformed_response" };
  }
}

export async function getSpreadsheetMetadata(
  input: { spreadsheetId: string; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<
  { ok: true; metadata: GoogleSpreadsheetMetadata } | { ok: false; reason: GoogleSheetsHttpFailure }
> {
  const url = `${GOOGLE_SHEETS_SPREADSHEETS_URL}/${encodeURIComponent(input.spreadsheetId)}?fields=${encodeURIComponent(METADATA_FIELDS)}`;
  assertSheetsApiUrl(url);
  let response: Response;
  try {
    response = await boundedFetch(fetchImpl, url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  const parsed = await readJson(response);
  if (!parsed.ok) return parsed;
  if (!response.ok) return { ok: false, reason: classifySheetsFailure(response.status) };
  const metadata = parseSpreadsheetMetadata(parsed.json, input.spreadsheetId);
  if (!metadata) return { ok: false, reason: "malformed_response" };
  return { ok: true, metadata };
}

export async function createSpreadsheet(
  input: { title: string; worksheetTitle: string; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<
  { ok: true; metadata: GoogleSpreadsheetMetadata } | { ok: false; reason: GoogleSheetsHttpFailure }
> {
  assertSheetsApiUrl(GOOGLE_SHEETS_SPREADSHEETS_URL);
  const body = {
    properties: { title: input.title },
    sheets: [{ properties: { title: input.worksheetTitle } }],
  };
  let response: Response;
  try {
    response = await boundedFetch(fetchImpl, GOOGLE_SHEETS_SPREADSHEETS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  const parsed = await readJson(response);
  if (!parsed.ok) return parsed;
  if (!response.ok) return { ok: false, reason: classifySheetsFailure(response.status) };
  const metadata = parseSpreadsheetMetadata(parsed.json);
  if (!metadata) return { ok: false, reason: "malformed_response" };
  return { ok: true, metadata };
}
