import {
  extractUsStateCode,
  extractUsZipCode,
  isCanonicalUsStateCode,
  sanitizeCanonicalUsStates,
} from "@sa360/shared";

export { extractUsStateCode, extractUsZipCode, isCanonicalUsStateCode, sanitizeCanonicalUsStates };

/** Normalize state to a canonical two-letter code, or null when not allowlisted. */
export function normalizeInventoryState(value: string | null | undefined): string | null {
  return extractUsStateCode(value);
}

export type PartitionedStateCounts<T extends { state: string; count: number }> = {
  canonical: T[];
  invalidCount: number;
  invalidByValue: Record<string, number>;
};

/** Split raw state aggregates so noncanonical values never become selectable options. */
export function partitionCanonicalStateCounts<T extends { state: string; count: number }>(
  rows: T[]
): PartitionedStateCounts<T> {
  const canonical: T[] = [];
  const invalidByValue: Record<string, number> = {};
  let invalidCount = 0;
  for (const row of rows) {
    if (isCanonicalUsStateCode(row.state)) {
      canonical.push(row);
      continue;
    }
    invalidCount += row.count;
    invalidByValue[row.state] = (invalidByValue[row.state] ?? 0) + row.count;
  }
  return { canonical, invalidCount, invalidByValue };
}
