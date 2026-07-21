import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildNicheBundleFromCsv,
  fixtureProvenance,
  isValidationCacheEligible,
  NICHE_LABELS,
  parseAndValidateAggregateInventoryCsv,
  type InventoryNicheKey,
  type InventoryNicheSummary,
  type InventorySnapshotProvider,
  type NormalizedInventorySnapshot,
} from "@sa360/shared";

const REPORT_FILES: Record<InventoryNicheKey, string> = {
  TRUCKER: "docs/demo/inventory/trucker-inventory-2026-07-20.csv",
  VET: "docs/demo/inventory/vet-inventory-2026-07-20.csv",
};

function resolveReportPath(relativePath: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), relativePath),
    join(process.cwd(), "../../", relativePath),
    join(here, "../../../../../../", relativePath),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      // try next
    }
  }
  return candidates[0]!;
}

export function loadInventoryReportCsvText(nicheKey: InventoryNicheKey): string {
  return readFileSync(resolveReportPath(REPORT_FILES[nicheKey]), "utf8");
}

/**
 * Read-only file provider over committed Lead Processor aggregate CSV fixtures.
 */
export class FileInventorySnapshotProvider implements InventorySnapshotProvider {
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
    const csvText = loadInventoryReportCsvText(input.nicheKey);
    const validation = parseAndValidateAggregateInventoryCsv(csvText);
    const bundle = buildNicheBundleFromCsv(input.nicheKey, csvText);
    return {
      nicheKey: input.nicheKey,
      bundle,
      provenance: fixtureProvenance({
        sourceUpdatedAt: bundle.snapshot.completedAt || null,
        validationWarnings: validation.warnings,
      }),
      cacheEligible: isValidationCacheEligible(validation),
    };
  }
}
