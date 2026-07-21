import {
  buildNicheBundleFromValidation,
  isValidationCacheEligible,
  NICHE_LABELS,
  parseAndValidateAggregateInventoryCsv,
  type InventoryNicheKey,
  type InventoryNicheSummary,
  type InventorySnapshotProvider,
  type NormalizedInventorySnapshot,
} from "@sa360/shared";

import {
  GoogleSheetsReadOnlyClient,
  isGoogleSheetsInventoryProviderEnabled,
  readGoogleSheetsConfigFromEnv,
  type GoogleSheetsReadOnlyConfig,
} from "./google-sheets-client.js";

export type GoogleSheetsInventoryProviderDeps = {
  client?: GoogleSheetsReadOnlyClient;
  config?: GoogleSheetsReadOnlyConfig | null;
  enabled?: boolean;
  /** Inject CSV text per niche for tests (bypasses live Sheets). */
  fetchCsv?: (nicheKey: InventoryNicheKey) => Promise<string>;
};

/**
 * Read-only Google Sheets inventory provider.
 *
 * Parsing + normalization path is complete (via injected CSV or future live fetch).
 * Live Google HTTP client remains a stub until summary tabs are confirmed.
 * Disabled by default (`INVENTORY_SHEETS_PROVIDER_ENABLED` must be exactly "true").
 */
export class GoogleSheetsInventorySnapshotProvider
  implements InventorySnapshotProvider
{
  private readonly enabled: boolean;
  private readonly fetchCsv?: (nicheKey: InventoryNicheKey) => Promise<string>;
  private readonly injectedClient: GoogleSheetsReadOnlyClient | null;
  private readonly injectedConfig: GoogleSheetsReadOnlyConfig | null | undefined;
  private lazyConfig: GoogleSheetsReadOnlyConfig | null | undefined;
  private lazyClient: GoogleSheetsReadOnlyClient | null | undefined;
  private googleFetchAttempts = 0;

  constructor(deps: GoogleSheetsInventoryProviderDeps = {}) {
    this.enabled = deps.enabled ?? isGoogleSheetsInventoryProviderEnabled();
    this.fetchCsv = deps.fetchCsv;
    this.injectedClient = deps.client ?? null;
    this.injectedConfig = deps.config;
    // Do not read credentials or construct a client when disabled.
    if (!this.enabled) {
      this.lazyConfig = null;
      this.lazyClient = null;
    }
  }

  /** Test helper: count of live client fetch attempts (not injectCsv). */
  getGoogleFetchAttemptCount(): number {
    return this.googleFetchAttempts;
  }

  isEnabled(): boolean {
    if (!this.enabled) return false;
    if (this.fetchCsv) return true;
    return Boolean(this.resolveClient() && this.resolveConfig());
  }

  async getAvailableNiches(): Promise<InventoryNicheSummary[]> {
    return (Object.keys(NICHE_LABELS) as InventoryNicheKey[]).map((key) => ({
      key,
      label: NICHE_LABELS[key],
    }));
  }

  async getSnapshot(input: {
    nicheKey: InventoryNicheKey;
    forceRefresh?: boolean;
  }): Promise<NormalizedInventorySnapshot> {
    if (!this.isEnabled()) {
      throw new Error("GoogleSheetsInventorySnapshotProvider is disabled");
    }

    const csvText = this.fetchCsv
      ? await this.fetchCsv(input.nicheKey)
      : await this.fetchFromSheets(input.nicheKey);

    const validation = parseAndValidateAggregateInventoryCsv(csvText);
    if (validation.completeness === "INVALID" || validation.errors.length > 0) {
      const err = new Error(
        `Invalid aggregate inventory summary for ${input.nicheKey}: ${
          validation.errors.join("; ") || validation.completeness
        }`
      );
      (err as Error & { validationWarnings?: string[] }).validationWarnings =
        validation.warnings;
      throw err;
    }

    const bundle = buildNicheBundleFromValidation(input.nicheKey, validation);
    const fetchedAt = new Date().toISOString();
    return {
      nicheKey: input.nicheKey,
      bundle,
      provenance: {
        source: "google_sheets",
        fetchedAt,
        sourceUpdatedAt: bundle.snapshot.completedAt || null,
        freshness: "fresh",
        fallbackStatus: "none",
        validationWarnings: validation.warnings,
      },
      cacheEligible: isValidationCacheEligible(validation),
    };
  }

  private resolveConfig(): GoogleSheetsReadOnlyConfig | null {
    if (this.injectedConfig !== undefined) return this.injectedConfig;
    if (this.lazyConfig !== undefined) return this.lazyConfig;
    this.lazyConfig = readGoogleSheetsConfigFromEnv();
    return this.lazyConfig;
  }

  private resolveClient(): GoogleSheetsReadOnlyClient | null {
    if (this.injectedClient) return this.injectedClient;
    if (this.lazyClient !== undefined) return this.lazyClient;
    const config = this.resolveConfig();
    this.lazyClient = config ? new GoogleSheetsReadOnlyClient(config) : null;
    return this.lazyClient;
  }

  private async fetchFromSheets(nicheKey: InventoryNicheKey): Promise<string> {
    const client = this.resolveClient();
    const config = this.resolveConfig();
    if (!client || !config) {
      throw new Error("Google Sheets client is not configured");
    }
    const spreadsheetId =
      nicheKey === "TRUCKER"
        ? config.truckerSpreadsheetId
        : config.vetSpreadsheetId;
    const range = `'${config.summaryTab}'!A:E`;
    this.googleFetchAttempts += 1;
    return client.fetchRangeAsCsv(spreadsheetId, range);
  }
}
