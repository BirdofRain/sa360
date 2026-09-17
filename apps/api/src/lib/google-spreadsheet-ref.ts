const SPREADSHEET_ID_PATTERN = /^[a-zA-Z0-9_-]{10,80}$/;
const PATH_ID_PATTERN =
  /^\/spreadsheets(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/;

export type GoogleSpreadsheetRefParseResult =
  | { ok: true; spreadsheetId: string }
  | { ok: false; reason: "empty" | "invalid" };

/**
 * Extract a spreadsheet ID from a raw ID or canonical Google Sheets URL.
 * Does not fetch the input. The ID is only later inserted into sheets.googleapis.com.
 */
export function parseGoogleSpreadsheetRef(raw: unknown): GoogleSpreadsheetRefParseResult {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty" };
  if (value.includes("\0") || /[\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, reason: "invalid" };
  }

  if (looksLikeUrl(value)) {
    const fromUrl = extractIdFromSheetsUrl(value);
    if (!fromUrl) return { ok: false, reason: "invalid" };
    return { ok: true, spreadsheetId: fromUrl };
  }

  if (value.includes("/") || value.includes("?") || value.includes("#") || value.includes("\\")) {
    return { ok: false, reason: "invalid" };
  }
  if (!SPREADSHEET_ID_PATTERN.test(value)) return { ok: false, reason: "invalid" };
  return { ok: true, spreadsheetId: value };
}

function looksLikeUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z+.-]*:/.test(value) || value.startsWith("//");
}

function extractIdFromSheetsUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.hostname !== "docs.google.com") return null;

  const pathname = url.pathname;
  if (pathname.includes("..") || pathname.includes("//")) return null;
  if (pathname.toLowerCase().includes("%2e") || pathname.toLowerCase().includes("%2f")) {
    return null;
  }

  const match = pathname.match(PATH_ID_PATTERN);
  if (!match?.[1]) return null;
  const spreadsheetId = match[1];
  if (!SPREADSHEET_ID_PATTERN.test(spreadsheetId)) return null;
  return spreadsheetId;
}
