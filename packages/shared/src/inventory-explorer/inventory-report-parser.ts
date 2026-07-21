/**
 * Section-aware Lead Processor inventory report parser.
 * Accepts mapped US/DC rows + unmapped geography codes from State Breakdown.
 */

import {
  isValidUsStateOrDcCode,
  US_STATE_AND_DC_CODES,
} from "./us-state-codes.js";

export type ReportCompleteness =
  | "COMPLETE"
  | "COMPLETE_WITH_WARNINGS"
  | "PARTIAL"
  | "INVALID";

export type AgeBucketKey = "1_3" | "3_6" | "6_plus";

export type AggregateBucketTotals = Record<AgeBucketKey, number> & {
  combined: number;
};

export type GeographyClassification = "MAPPED_US_DC" | "UNMAPPED_GEOGRAPHY";

export type AggregateGeographyRow = {
  code: string;
  classification: GeographyClassification;
  oneToThreeMonths: number;
  threeToSixMonths: number;
  sixPlusMonths: number;
  totalAvailable: number;
  sourceLine: number;
};

export type LeadProcessorReportMetadata = {
  reportVersion: string;
  sourceSheet: string;
  startedAtRaw: string;
  completedAtRaw: string;
  generatedAt: string;
  completedAt: string;
  sourceRowsAvailable: number;
  rowsScanned: number;
  publishedTotals: AggregateBucketTotals;
};

export type InventoryReportValidation = {
  completeness: ReportCompleteness;
  metadata: LeadProcessorReportMetadata;
  mappedRows: AggregateGeographyRow[];
  unmappedRows: AggregateGeographyRow[];
  publishedTotals: AggregateBucketTotals;
  mappedTotals: AggregateBucketTotals;
  unmappedTotals: AggregateBucketTotals;
  reconciliationDifferences: AggregateBucketTotals;
  reconciledNationalTotals: boolean;
  mappedGeographyCount: number;
  unmappedGeographyCount: number;
  missingMappedStateCodes: string[];
  stateBreakdownFound: boolean;
  stateTableHeaderFound: boolean;
  warnings: string[];
  errors: string[];
};

const NEXT_SECTION =
  /^\s*(skipped\s*\/\s*excluded|bucket\s*totals?|fast\s*lead|appendix|notes?)\b/i;

const STATE_BREAKDOWN = /^\s*state\s*breakdown\s*$/i;

type HeaderLayout = {
  codeIdx: number;
  b1: number;
  b2: number;
  b3: number;
  totalIdx: number;
};

function emptyTotals(): AggregateBucketTotals {
  return { "1_3": 0, "3_6": 0, "6_plus": 0, combined: 0 };
}

function sumTotals(rows: AggregateGeographyRow[]): AggregateBucketTotals {
  const t = emptyTotals();
  for (const r of rows) {
    t["1_3"] += r.oneToThreeMonths;
    t["3_6"] += r.threeToSixMonths;
    t["6_plus"] += r.sixPlusMonths;
  }
  t.combined = t["1_3"] + t["3_6"] + t["6_plus"];
  return t;
}

function splitCsvLine(line: string): string[] {
  return line.split(",").map((c) => c.trim());
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseNonNegativeInt(raw: string, label: string): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a non-negative integer (got "${raw}")`);
  }
  return Number(trimmed);
}

/** Convert Lead Processor date like 7/20/2026 → ISO UTC midnight / end-of-day. */
export function parseLeadProcessorDate(
  raw: string,
  endOfDay = false
): string {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return raw.trim();
  const month = m[1]!.padStart(2, "0");
  const day = m[2]!.padStart(2, "0");
  const year = m[3]!;
  return endOfDay
    ? `${year}-${month}-${day}T23:59:59.000Z`
    : `${year}-${month}-${day}T00:00:00.000Z`;
}

function matchStateTableHeader(cells: string[]): HeaderLayout | null {
  const n = cells.map(normalizeHeader);
  const patterns: Array<{ cells: string[]; layout: HeaderLayout }> = [
    {
      cells: ["state", "1-3 months", "3-6 months", "6+ months", "total available"],
      layout: { codeIdx: 0, b1: 1, b2: 2, b3: 3, totalIdx: 4 },
    },
    {
      cells: [
        "state",
        "one_to_three_months",
        "three_to_six_months",
        "six_plus_months",
        "total_available",
      ],
      layout: { codeIdx: 0, b1: 1, b2: 2, b3: 3, totalIdx: 4 },
    },
  ];
  for (const pattern of patterns) {
    if (pattern.cells.every((expected, i) => n[i] === expected)) {
      return pattern.layout;
    }
  }
  return null;
}

function parsePublishedBucketTotals(lines: string[]): AggregateBucketTotals {
  const totals = emptyTotals();
  let inBuckets = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^bucket\s*totals?$/i.test(trimmed.replace(/,+$/, ""))) {
      inBuckets = true;
      continue;
    }
    if (inBuckets) {
      if (STATE_BREAKDOWN.test(trimmed.replace(/,+$/, ""))) break;
      if (NEXT_SECTION.test(trimmed.replace(/,+$/, "")) && !/^bucket/i.test(trimmed)) {
        break;
      }
      const cells = splitCsvLine(trimmed);
      const label = normalizeHeader(cells[0] ?? "");
      const value = Number(cells[1] ?? "");
      if (label === "1-3 months" && Number.isFinite(value)) totals["1_3"] = value;
      if (label === "3-6 months" && Number.isFinite(value)) totals["3_6"] = value;
      if ((label === "6+ months" || label === "6 plus months") && Number.isFinite(value)) {
        totals["6_plus"] = value;
      }
    }
  }
  totals.combined = totals["1_3"] + totals["3_6"] + totals["6_plus"];
  return totals;
}

function parseMetadata(lines: string[]): Omit<
  LeadProcessorReportMetadata,
  "publishedTotals"
> {
  const kv: Record<string, string> = {};
  for (const line of lines) {
    const cells = splitCsvLine(line);
    const key = (cells[0] ?? "").trim();
    const value = (cells[1] ?? "").trim();
    if (!key || !value) continue;
    kv[normalizeHeader(key)] = value;
  }
  const startedRaw = kv["started at"] ?? "";
  const completedRaw = kv["completed at"] ?? "";
  return {
    reportVersion: kv.version ?? "",
    sourceSheet: kv["source sheet"] ?? "",
    startedAtRaw: startedRaw,
    completedAtRaw: completedRaw,
    generatedAt: parseLeadProcessorDate(startedRaw, false),
    completedAt: parseLeadProcessorDate(completedRaw, true),
    sourceRowsAvailable: Number(kv["source rows available"] ?? 0) || 0,
    rowsScanned: Number(kv["rows scanned"] ?? 0) || 0,
  };
}

function hasSensitiveColumns(cells: string[]): string[] {
  const sensitive =
    /^(first_?name|last_?name|full_?name|phone|email|address|lead_?id|contact_?id|notes?)$/i;
  return cells.filter((c) => sensitive.test(normalizeHeader(c)));
}

export function parseAndValidateAggregateInventoryCsv(
  csvText: string
): InventoryReportValidation {
  const lines = csvText.split(/\r?\n/);
  const warnings: string[] = [];
  const errors: string[] = [];

  const metaBase = parseMetadata(lines);
  const publishedTotals = parsePublishedBucketTotals(lines);
  const metadata: LeadProcessorReportMetadata = {
    ...metaBase,
    publishedTotals,
  };

  let stateBreakdownFound = false;
  let stateTableHeaderFound = false;
  let headerLayout: HeaderLayout | null = null;
  let inBreakdown = false;
  let headerSeen = false;

  const mappedRows: AggregateGeographyRow[] = [];
  const unmappedRows: AggregateGeographyRow[] = [];
  const seen = new Map<string, number[]>();

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.replace(/,/g, "") === "") continue;
    const sectionLabel = trimmed.replace(/,+$/, "").trim();
    const cells = splitCsvLine(trimmed);

    if (!inBreakdown) {
      if (STATE_BREAKDOWN.test(sectionLabel)) {
        stateBreakdownFound = true;
        inBreakdown = true;
      }
      continue;
    }

    if (!headerSeen) {
      const layout = matchStateTableHeader(cells);
      if (layout) {
        headerSeen = true;
        stateTableHeaderFound = true;
        headerLayout = layout;
        const sensitive = hasSensitiveColumns(cells);
        if (sensitive.length > 0) {
          errors.push(
            `Unexpected sensitive columns in State Breakdown: ${sensitive.join(", ")}`
          );
        }
        continue;
      }
      if (NEXT_SECTION.test(sectionLabel) || STATE_BREAKDOWN.test(sectionLabel)) {
        errors.push("State Breakdown ended before a recognizable table header");
        break;
      }
      continue;
    }

    if (NEXT_SECTION.test(sectionLabel) || STATE_BREAKDOWN.test(sectionLabel)) {
      break;
    }

    const codeRaw = (cells[headerLayout!.codeIdx] ?? "").trim();
    if (!/^[A-Za-z]{2}$/.test(codeRaw)) {
      if (mappedRows.length + unmappedRows.length > 0) {
        warnings.push(
          `State Breakdown stopped at line ${lineNo}: structurally invalid row`
        );
        break;
      }
      continue;
    }

    const code = codeRaw.toUpperCase();
    try {
      const oneToThreeMonths = parseNonNegativeInt(
        cells[headerLayout!.b1] ?? "",
        `${code} 1-3 months`
      );
      const threeToSixMonths = parseNonNegativeInt(
        cells[headerLayout!.b2] ?? "",
        `${code} 3-6 months`
      );
      const sixPlusMonths = parseNonNegativeInt(
        cells[headerLayout!.b3] ?? "",
        `${code} 6+ months`
      );
      const totalAvailable = parseNonNegativeInt(
        cells[headerLayout!.totalIdx] ?? "",
        `${code} total`
      );
      const bucketSum = oneToThreeMonths + threeToSixMonths + sixPlusMonths;
      if (bucketSum !== totalAvailable) {
        errors.push(
          `${code} line ${lineNo}: row total ${totalAvailable} != bucket sum ${bucketSum}`
        );
        continue;
      }

      const prev = seen.get(code) ?? [];
      prev.push(lineNo);
      seen.set(code, prev);

      const row: AggregateGeographyRow = {
        code,
        classification: isValidUsStateOrDcCode(code)
          ? "MAPPED_US_DC"
          : "UNMAPPED_GEOGRAPHY",
        oneToThreeMonths,
        threeToSixMonths,
        sixPlusMonths,
        totalAvailable,
        sourceLine: lineNo,
      };
      if (row.classification === "MAPPED_US_DC") mappedRows.push(row);
      else unmappedRows.push(row);
    } catch (err) {
      errors.push(
        err instanceof Error
          ? `State Breakdown line ${lineNo}: ${err.message}`
          : `State Breakdown line ${lineNo}: invalid numbers`
      );
    }
  }

  for (const [code, lineNos] of seen) {
    if (lineNos.length > 1) {
      errors.push(
        `Duplicate geography code ${code} at lines ${lineNos.join(", ")}`
      );
    }
  }

  // Clear accepted rows on duplicates (ambiguous)
  const duplicatesExist = [...seen.values()].some((v) => v.length > 1);
  const finalMapped = duplicatesExist ? [] : mappedRows;
  const finalUnmapped = duplicatesExist ? [] : unmappedRows;
  if (duplicatesExist) {
    warnings.push(
      "Accepted geography rows cleared because duplicate codes make the report ambiguous"
    );
  }

  if (!stateBreakdownFound) {
    errors.push('Authoritative "State Breakdown" section heading was not found');
  }
  if (stateBreakdownFound && !stateTableHeaderFound) {
    errors.push("State Breakdown table header was not found");
  }

  const mappedTotals = sumTotals(finalMapped);
  const unmappedTotals = sumTotals(finalUnmapped);
  const combinedCalculated: AggregateBucketTotals = {
    "1_3": mappedTotals["1_3"] + unmappedTotals["1_3"],
    "3_6": mappedTotals["3_6"] + unmappedTotals["3_6"],
    "6_plus": mappedTotals["6_plus"] + unmappedTotals["6_plus"],
    combined: mappedTotals.combined + unmappedTotals.combined,
  };

  const reconciliationDifferences: AggregateBucketTotals = {
    "1_3": combinedCalculated["1_3"] - publishedTotals["1_3"],
    "3_6": combinedCalculated["3_6"] - publishedTotals["3_6"],
    "6_plus": combinedCalculated["6_plus"] - publishedTotals["6_plus"],
    combined: combinedCalculated.combined - publishedTotals.combined,
  };

  const reconciledNationalTotals =
    finalMapped.length + finalUnmapped.length > 0 &&
    reconciliationDifferences["1_3"] === 0 &&
    reconciliationDifferences["3_6"] === 0 &&
    reconciliationDifferences["6_plus"] === 0;

  if (
    stateBreakdownFound &&
    stateTableHeaderFound &&
    finalMapped.length + finalUnmapped.length > 0 &&
    !reconciledNationalTotals
  ) {
    errors.push(
      `National totals do not reconcile (mapped+unmapped ${combinedCalculated.combined} vs published ${publishedTotals.combined}). Counts were not altered.`
    );
  }

  const mappedCodes = new Set(finalMapped.map((r) => r.code));
  const missingMappedStateCodes = US_STATE_AND_DC_CODES.filter(
    (c) => !mappedCodes.has(c)
  );

  if (finalUnmapped.length > 0) {
    warnings.push(
      `${finalUnmapped.length} unmapped geography code(s) retained in report totals but excluded from the 50-state + DC map`
    );
  }

  const completeness = determineCompleteness({
    stateBreakdownFound,
    stateTableHeaderFound,
    errors,
    duplicatesExist,
    reconciledNationalTotals,
    missingMappedCount: missingMappedStateCodes.length,
    mappedCount: finalMapped.length,
    unmappedCount: finalUnmapped.length,
  });

  return {
    completeness,
    metadata,
    mappedRows: finalMapped,
    unmappedRows: finalUnmapped,
    publishedTotals,
    mappedTotals,
    unmappedTotals,
    reconciliationDifferences,
    reconciledNationalTotals,
    mappedGeographyCount: finalMapped.length,
    unmappedGeographyCount: finalUnmapped.length,
    missingMappedStateCodes: [...missingMappedStateCodes],
    stateBreakdownFound,
    stateTableHeaderFound,
    warnings,
    errors,
  };
}

function determineCompleteness(input: {
  stateBreakdownFound: boolean;
  stateTableHeaderFound: boolean;
  errors: string[];
  duplicatesExist: boolean;
  reconciledNationalTotals: boolean;
  missingMappedCount: number;
  mappedCount: number;
  unmappedCount: number;
}): ReportCompleteness {
  if (
    !input.stateBreakdownFound ||
    !input.stateTableHeaderFound ||
    input.duplicatesExist ||
    input.errors.length > 0 ||
    input.mappedCount === 0
  ) {
    return "INVALID";
  }
  if (!input.reconciledNationalTotals) return "INVALID";

  if (
    input.missingMappedCount === 0 &&
    input.mappedCount === US_STATE_AND_DC_CODES.length
  ) {
    return input.unmappedCount > 0 ? "COMPLETE_WITH_WARNINGS" : "COMPLETE";
  }
  if (input.missingMappedCount > 0) return "PARTIAL";
  return "INVALID";
}
