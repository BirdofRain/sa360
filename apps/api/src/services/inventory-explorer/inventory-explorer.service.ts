import {
  assembleInventoryExplorerReadModel,
  NICHE_LABELS,
  type InventoryExplorerReadModel,
  type InventoryNicheKey,
  type InventoryNicheSummary,
  type InventorySnapshotProvider,
  type NormalizedInventorySnapshot,
} from "@sa360/shared";

import { redis } from "../../lib/redis.js";
import { FileInventorySnapshotProvider } from "./file-inventory-snapshot-provider.js";
import { GoogleSheetsInventorySnapshotProvider } from "./google-sheets-inventory-provider.js";
import { InventorySnapshotCache } from "./inventory-snapshot-cache.js";

const SOFT_STALE_MS = 15 * 60 * 1000;

export type InventoryExplorerServiceDeps = {
  sheetsProvider?: GoogleSheetsInventorySnapshotProvider;
  fileProvider?: FileInventorySnapshotProvider;
  cache?: InventorySnapshotCache;
  now?: () => Date;
  /** When true, skip Redis and use memory-only cache (tests). */
  memoryCacheOnly?: boolean;
};

/**
 * Composes Sheets (optional) → valid cache → CSV fixture fallback.
 * Invalid live data never overwrites a valid cached snapshot.
 */
export class InventoryExplorerService implements InventorySnapshotProvider {
  private readonly sheets: GoogleSheetsInventorySnapshotProvider;
  private readonly file: FileInventorySnapshotProvider;
  private readonly cache: InventorySnapshotCache;
  private readonly now: () => Date;

  constructor(deps: InventoryExplorerServiceDeps = {}) {
    this.sheets = deps.sheetsProvider ?? new GoogleSheetsInventorySnapshotProvider();
    this.file = deps.fileProvider ?? new FileInventorySnapshotProvider();
    this.cache =
      deps.cache ??
      new InventorySnapshotCache(deps.memoryCacheOnly ? null : redis);
    this.now = deps.now ?? (() => new Date());
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
    const sheetsEnabled = this.sheets.isEnabled();

    let sheetsFailureWarnings: string[] = [];

    if (sheetsEnabled) {
      try {
        const live = await this.sheets.getSnapshot(input);
        if (live.cacheEligible) {
          await this.cache.set(input.nicheKey, live);
        }
        return live;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Google Sheets inventory fetch failed";
        const extra =
          err instanceof Error &&
          Array.isArray(
            (err as Error & { validationWarnings?: string[] }).validationWarnings
          )
            ? (err as Error & { validationWarnings: string[] }).validationWarnings
            : [];
        sheetsFailureWarnings = [message, ...extra];
      }
    }

    // forceRefresh only forces a Sheets attempt; it must never discard the last
    // valid cached snapshot when live fetch is unavailable or invalid.
    const cached = await this.cache.get(input.nicheKey);
    if (cached) {
      const parsedCachedAt = Date.parse(cached.cachedAt || "");
      const ageMs = Number.isFinite(parsedCachedAt)
        ? this.now().getTime() - parsedCachedAt
        : 0;
      const invalidLive = sheetsFailureWarnings.some((w) =>
        /invalid/i.test(w)
      );
      return {
        ...cached.snapshot,
        provenance: {
          ...cached.snapshot.provenance,
          source: "cached_google_sheets",
          fetchedAt: this.now().toISOString(),
          freshness: ageMs > SOFT_STALE_MS ? "stale" : "fallback",
          fallbackStatus: invalidLive
            ? "sheets_invalid"
            : sheetsFailureWarnings.length > 0
              ? "sheets_unavailable"
              : "used_cache",
          validationWarnings: [
            ...cached.snapshot.provenance.validationWarnings,
            ...sheetsFailureWarnings,
          ],
        },
        cacheEligible: false,
      };
    }

    const fixture = await this.file.getSnapshot(input);
    return {
      ...fixture,
      provenance: {
        ...fixture.provenance,
        fetchedAt: this.now().toISOString(),
        freshness: "fallback",
        fallbackStatus:
          sheetsFailureWarnings.length > 0
            ? sheetsFailureWarnings.some((w) => /invalid/i.test(w))
              ? "sheets_invalid"
              : "used_fixture"
            : "used_fixture",
        validationWarnings: [
          ...fixture.provenance.validationWarnings,
          ...sheetsFailureWarnings,
        ],
      },
    };
  }

  async getReadModel(input?: {
    forceRefresh?: boolean;
  }): Promise<InventoryExplorerReadModel> {
    const trucker = await this.getSnapshot({
      nicheKey: "TRUCKER",
      forceRefresh: input?.forceRefresh,
    });
    const vet = await this.getSnapshot({
      nicheKey: "VET",
      forceRefresh: input?.forceRefresh,
    });

    // Prefer the less-fallback freshness when niches disagree.
    const provenance =
      trucker.provenance.source === "google_sheets" ||
      vet.provenance.source === "google_sheets"
        ? trucker.provenance.source === "google_sheets"
          ? trucker.provenance
          : vet.provenance
        : trucker.provenance.source === "cached_google_sheets" ||
            vet.provenance.source === "cached_google_sheets"
          ? trucker.provenance.source === "cached_google_sheets"
            ? trucker.provenance
            : vet.provenance
          : trucker.provenance;

    const dataSource =
      provenance.source === "fixture_csv" &&
      provenance.fallbackStatus === "used_fixture" &&
      !this.sheets.isEnabled()
        ? "mock"
        : "live";

    return assembleInventoryExplorerReadModel({
      niches: {
        TRUCKER: trucker.bundle,
        VET: vet.bundle,
      },
      dataSource,
      provenance: {
        ...provenance,
        validationWarnings: [
          ...new Set([
            ...trucker.provenance.validationWarnings,
            ...vet.provenance.validationWarnings,
          ]),
        ],
      },
    });
  }
}

let defaultService: InventoryExplorerService | null = null;

export function getInventoryExplorerService(): InventoryExplorerService {
  if (!defaultService) {
    defaultService = new InventoryExplorerService();
  }
  return defaultService;
}

/** Test helper */
export function setInventoryExplorerServiceForTests(
  service: InventoryExplorerService | null
): void {
  defaultService = service;
}
