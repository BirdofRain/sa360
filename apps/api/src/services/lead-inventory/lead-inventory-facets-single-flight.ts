/**
 * In-process single-flight for identical Lead Inventory facets computations.
 * Cache keys contain only normalized filter fields — never auth tokens or PII.
 */

type FlightEntry<T> = {
  promise: Promise<T>;
};

const inflight = new Map<string, FlightEntry<unknown>>();

export function normalizeFacetsFlightKey(filters: Record<string, unknown>): string {
  const keys = Object.keys(filters).sort();
  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    const value = filters[key];
    if (value === undefined || value === null || value === "") continue;
    normalized[key] = value;
  }
  return JSON.stringify(normalized);
}

export async function runFacetsSingleFlight<T>(
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const existing = inflight.get(key) as FlightEntry<T> | undefined;
  if (existing) return existing.promise;

  const promise = work().finally(() => {
    const current = inflight.get(key);
    if (current?.promise === promise) inflight.delete(key);
  });

  inflight.set(key, { promise });
  return promise;
}

/** Test seam — clears in-flight entries between cases. */
export function resetFacetsSingleFlightForTests(): void {
  inflight.clear();
}

export function facetsSingleFlightSizeForTests(): number {
  return inflight.size;
}
