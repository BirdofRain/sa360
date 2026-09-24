/**
 * Google Sheets destination setup (Phase 1C). Independent of SA360_GOOGLE_OAUTH_ENABLED.
 * Deny-by-default: only the exact case-insensitive value "true" enables Sheets destination HTTP.
 */
export const GOOGLE_SHEETS_API_ORIGIN = "https://sheets.googleapis.com";
export const GOOGLE_SHEETS_SPREADSHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
export const GOOGLE_SHEETS_HTTP_TIMEOUT_MS = 10_000;
export const GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY = "google_sheets.v1";
export const GOOGLE_SHEETS_HEADER_SCHEMA_VERSION = "sheets_delivery_v1";
export const GOOGLE_SHEETS_DEFAULT_SPREADSHEET_TITLE = "SA360 Leads";
export const GOOGLE_SHEETS_DEFAULT_WORKSHEET_TITLE = "Leads";
export const GOOGLE_SHEETS_TARGET_DISPLAY_NAME = "Google Sheets";
export const GOOGLE_SHEETS_READINESS_CONFIGURED = "configured";
/** Access tokens expiring within this window are refreshed on demand. */
export const GOOGLE_ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60_000;

export function isGoogleSheetsDestinationEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.SA360_GOOGLE_SHEETS_DESTINATION_ENABLED?.trim().toLowerCase() === "true";
}

/** Phase 1C destinations are configured only and must not enter LF2 planning/execution. */
export function isGoogleSheetsLf2PlanningExcluded(adapterKey: string): boolean {
  return adapterKey.trim() === GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY;
}

/** Google assigns worksheet `sheetId` as a signed 32-bit integer. */
export const GOOGLE_SHEETS_MAX_WORKSHEET_ID = 2_147_483_647;

/**
 * Accept only a real, in-range worksheet id. Numeric strings, NaN, Infinity,
 * floats, negatives, and values beyond the Sheets int32 range are rejected
 * rather than forwarded into a Google request.
 */
export function parseGoogleWorksheetId(raw: unknown): number | null {
  if (typeof raw !== "number") return null;
  if (!Number.isSafeInteger(raw)) return null;
  if (raw < 0 || raw > GOOGLE_SHEETS_MAX_WORKSHEET_ID) return null;
  return raw;
}

export function buildSafeSpreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}

export function isSafeGoogleSpreadsheetUrl(url: string, spreadsheetId: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.hostname !== "docs.google.com") return false;
    return parsed.pathname === `/spreadsheets/d/${spreadsheetId}` ||
      parsed.pathname.startsWith(`/spreadsheets/d/${spreadsheetId}/`);
  } catch {
    return false;
  }
}
