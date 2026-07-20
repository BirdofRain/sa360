import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseAndValidateAggregateInventoryCsv,
  type InventoryReportValidation,
} from "./inventory-report-parser";
import {
  AGE_BUCKET_OPTIONS,
  AVAILABLE_TIMEZONES,
  type AgeBucketKey,
  type InventoryExplorerReadModel,
  type InventoryNicheBundle,
  type InventoryNicheKey,
  type InventorySnapshot,
  type InventoryStateRecord,
  type TopStateIndicator,
  type UnmappedGeography,
} from "./inventory-types";
import { STATE_TIMEZONE_META } from "./state-timezone-meta";
import { US_STATE_AND_DC_CODES } from "./us-state-codes";

const EMPTY_BUCKETS: Record<AgeBucketKey, number> = {
  "1_3": 0,
  "3_6": 0,
  "6_plus": 0,
};

const REPORT_FILES: Record<InventoryNicheKey, string> = {
  TRUCKER: "docs/demo/inventory/trucker-inventory-2026-07-20.csv",
  VET: "docs/demo/inventory/vet-inventory-2026-07-20.csv",
};

const NICHE_LABELS: Record<InventoryNicheKey, string> = {
  TRUCKER: "Truckers",
  VET: "VET",
};

function resolveReportPath(relativePath: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../../../../../", relativePath),
    join(process.cwd(), relativePath),
    join(process.cwd(), "../../", relativePath),
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

function topForBucket(
  rows: InventoryReportValidation["mappedRows"],
  pick: (r: InventoryReportValidation["mappedRows"][number]) => number
): TopStateIndicator | null {
  if (rows.length === 0) return null;
  let best = rows[0]!;
  let bestValue = pick(best);
  for (const row of rows.slice(1)) {
    const value = pick(row);
    if (value > bestValue) {
      best = row;
      bestValue = value;
    }
  }
  return {
    stateCode: best.code,
    stateName: STATE_TIMEZONE_META[best.code]?.stateName ?? best.code,
    value: bestValue,
  };
}

function reportLabel(
  nicheKey: InventoryNicheKey,
  validation: InventoryReportValidation
): string {
  const sheet = validation.metadata.sourceSheet || nicheKey;
  const ver = validation.metadata.reportVersion || "5.0.0";
  return `${sheet} aggregate snapshot v${ver} (${validation.completeness})`;
}

function buildSnapshot(
  nicheKey: InventoryNicheKey,
  validation: InventoryReportValidation
): InventorySnapshot {
  return {
    reportVersion: validation.metadata.reportVersion,
    nicheKey,
    sourceSheet: validation.metadata.sourceSheet,
    generatedAt: validation.metadata.generatedAt,
    completedAt: validation.metadata.completedAt,
    sourceRowsAvailable: validation.metadata.sourceRowsAvailable,
    rowsScanned: validation.metadata.rowsScanned,
    completeness: validation.completeness,
    publishedTotals: validation.publishedTotals,
    mappedTotals: validation.mappedTotals,
    unmappedTotals: validation.unmappedTotals,
    mappedGeographyCount: validation.mappedGeographyCount,
    unmappedGeographyCount: validation.unmappedGeographyCount,
    warnings: validation.warnings,
    validationErrors: validation.errors,
    reconciledNationalTotals: validation.reconciledNationalTotals,
    reportLabel: reportLabel(nicheKey, validation),
    isPartialReport:
      validation.completeness === "PARTIAL" ||
      validation.completeness === "INVALID",
    snapshotUnverified: validation.completeness === "INVALID",
    topInventoryState: topForBucket(
      validation.mappedRows,
      (r) => r.totalAvailable
    ),
    strongestByAgeBucket: {
      "1_3": topForBucket(validation.mappedRows, (r) => r.oneToThreeMonths),
      "3_6": topForBucket(validation.mappedRows, (r) => r.threeToSixMonths),
      "6_plus": topForBucket(validation.mappedRows, (r) => r.sixPlusMonths),
    },
  };
}

function buildStates(
  validation: InventoryReportValidation
): InventoryStateRecord[] {
  const byCode = new Map(validation.mappedRows.map((r) => [r.code, r] as const));
  const treatAbsentAsKnownZero =
    validation.completeness === "COMPLETE" ||
    validation.completeness === "COMPLETE_WITH_WARNINGS";
  const allowKnown =
    validation.completeness === "COMPLETE" ||
    validation.completeness === "COMPLETE_WITH_WARNINGS" ||
    validation.completeness === "PARTIAL";

  return US_STATE_AND_DC_CODES.map((stateCode) => {
    const meta = STATE_TIMEZONE_META[stateCode]!;
    const row = byCode.get(stateCode);
    if (row && allowKnown) {
      return {
        stateCode,
        stateName: meta.stateName,
        timezones: meta.timezones,
        timezoneStatus: meta.timezoneStatus,
        countsByAgeBucket: {
          "1_3": row.oneToThreeMonths,
          "3_6": row.threeToSixMonths,
          "6_plus": row.sixPlusMonths,
        },
        dataStatus: "known" as const,
      };
    }
    return {
      stateCode,
      stateName: meta.stateName,
      timezones: meta.timezones,
      timezoneStatus: meta.timezoneStatus,
      countsByAgeBucket: { ...EMPTY_BUCKETS },
      dataStatus: treatAbsentAsKnownZero
        ? ("known" as const)
        : ("unknown" as const),
    };
  }).sort((a, b) => a.stateCode.localeCompare(b.stateCode));
}

function buildUnmapped(
  validation: InventoryReportValidation
): UnmappedGeography[] {
  return validation.unmappedRows
    .map((r) => ({
      code: r.code,
      countsByAgeBucket: {
        "1_3": r.oneToThreeMonths,
        "3_6": r.threeToSixMonths,
        "6_plus": r.sixPlusMonths,
      },
      totalAvailable: r.totalAvailable,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function buildNicheBundleFromCsv(
  nicheKey: InventoryNicheKey,
  csvText: string
): InventoryNicheBundle {
  const validation = parseAndValidateAggregateInventoryCsv(csvText);
  return {
    nicheKey,
    label: NICHE_LABELS[nicheKey],
    snapshot: buildSnapshot(nicheKey, validation),
    states: buildStates(validation),
    unmappedGeographies: buildUnmapped(validation),
  };
}

export function getInventoryExplorerFixtureFromReports(input: {
  truckerCsv: string;
  vetCsv: string;
}): InventoryExplorerReadModel {
  const trucker = buildNicheBundleFromCsv("TRUCKER", input.truckerCsv);
  const vet = buildNicheBundleFromCsv("VET", input.vetCsv);
  return {
    dataSource: "mock",
    availableNiches: [
      { key: "TRUCKER", label: NICHE_LABELS.TRUCKER },
      { key: "VET", label: NICHE_LABELS.VET },
    ],
    availableAgeBuckets: AGE_BUCKET_OPTIONS,
    availableTimezones: AVAILABLE_TIMEZONES,
    niches: {
      TRUCKER: trucker,
      VET: vet,
    },
    defaultFilters: {
      nicheKey: "TRUCKER",
      selectedAgeBuckets: ["6_plus"],
      selectedTimezone: null,
      requestedQuantity: 100,
    },
    capabilities: {
      canCreateOrder: false,
      canReserveInventory: false,
      canRequestQuote: false,
      canReviewAdditionalInventory: true,
    },
  };
}

export function getInventoryExplorerFixture(): InventoryExplorerReadModel {
  return getInventoryExplorerFixtureFromReports({
    truckerCsv: loadInventoryReportCsvText("TRUCKER"),
    vetCsv: loadInventoryReportCsvText("VET"),
  });
}

/** @deprecated Use niche-specific loaders; kept for transitional tests. */
export function getInventoryExplorerFixtureFromCsv(
  csvText: string
): InventoryExplorerReadModel {
  return getInventoryExplorerFixtureFromReports({
    truckerCsv: csvText,
    vetCsv: loadInventoryReportCsvText("VET"),
  });
}
