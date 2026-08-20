import {
  CANONICAL_US_STATE_CODES,
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
  const canonicalByState = new Map<string, T>();
  const invalidByValue: Record<string, number> = {};
  let invalidCount = 0;
  for (const row of rows) {
    if (isCanonicalUsStateCode(row.state)) {
      const existing = canonicalByState.get(row.state);
      if (existing) {
        canonicalByState.set(row.state, { ...existing, count: existing.count + row.count });
      } else {
        canonicalByState.set(row.state, row);
      }
      continue;
    }
    invalidCount += row.count;
    invalidByValue[row.state] = (invalidByValue[row.state] ?? 0) + row.count;
  }
  const order = new Map<string, number>(CANONICAL_US_STATE_CODES.map((code, index) => [code, index]));
  const canonical = [...canonicalByState.values()].sort(
    (a, b) => (order.get(a.state) ?? 0) - (order.get(b.state) ?? 0)
  );
  return { canonical, invalidCount, invalidByValue };
}
