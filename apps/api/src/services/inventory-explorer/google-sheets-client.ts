/**
 * Read-only Google Sheets client for Inventory Explorer aggregate summary tabs.
 *
 * Implementation status (foundation checkpoint):
 * - Config + readonly scope + private-key newline normalization: present
 * - Live googleapis JWT auth + HTTP values.get: NOT implemented (stub)
 * - Request timeout / typed network errors: NOT implemented (blocked on live client)
 *
 * Hard rules:
 * - Scope must be spreadsheets.readonly only
 * - No append/update/clear/batchUpdate write methods
 * - Only fetch aggregate summary ranges (never lead-level worksheets)
 * - Do not construct/read credentials unless the feature flag is enabled
 */

export const GOOGLE_SHEETS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";

export type GoogleSheetsReadOnlyConfig = {
  clientEmail: string;
  privateKey: string;
  truckerSpreadsheetId: string;
  vetSpreadsheetId: string;
  summaryTab: string;
};

export function isGoogleSheetsInventoryProviderEnabled(): boolean {
  return process.env.INVENTORY_SHEETS_PROVIDER_ENABLED?.trim() === "true";
}

/**
 * Reads Sheets config from env. Call only when the provider flag is enabled
 * (or from tests that inject config explicitly).
 */
export function readGoogleSheetsConfigFromEnv(): GoogleSheetsReadOnlyConfig | null {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.trim();
  const truckerSpreadsheetId =
    process.env.INVENTORY_SHEETS_TRUCKER_SPREADSHEET_ID?.trim();
  const vetSpreadsheetId =
    process.env.INVENTORY_SHEETS_VET_SPREADSHEET_ID?.trim();
  const summaryTab =
    process.env.INVENTORY_SHEETS_SUMMARY_TAB?.trim() || "Inventory Summary";

  if (
    !clientEmail ||
    !privateKeyRaw ||
    !truckerSpreadsheetId ||
    !vetSpreadsheetId
  ) {
    return null;
  }

  return {
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
    truckerSpreadsheetId,
    vetSpreadsheetId,
    summaryTab,
  };
}

/**
 * Stub client — throws until googleapis is added and summary tabs are confirmed.
 * Intentionally exposes only a values.get-style read path.
 */
export class GoogleSheetsReadOnlyClient {
  constructor(private readonly config: GoogleSheetsReadOnlyConfig) {}

  get scopes(): string[] {
    return [GOOGLE_SHEETS_READONLY_SCOPE];
  }

  get spreadsheetIds(): {
    trucker: string;
    vet: string;
    summaryTab: string;
  } {
    return {
      trucker: this.config.truckerSpreadsheetId,
      vet: this.config.vetSpreadsheetId,
      summaryTab: this.config.summaryTab,
    };
  }

  /** Read-only: fetch a single range as CSV-shaped text. Live HTTP not wired yet. */
  async fetchRangeAsCsv(
    _spreadsheetId: string,
    _rangeA1: string
  ): Promise<string> {
    void this.config;
    void _spreadsheetId;
    void _rangeA1;
    throw new Error(
      "Google Sheets live client is not implemented. Aggregate summary tabs must be confirmed and googleapis readonly values.get wired before enabling production Sheets reads."
    );
  }

  // Explicitly absent write surface (do not add):
  // appendValues, updateValues, batchUpdate, clearValues, createSpreadsheet
}
