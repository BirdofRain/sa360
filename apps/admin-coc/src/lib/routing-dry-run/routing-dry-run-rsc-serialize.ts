import type { RoutingDryRunDecisionView } from "./routing-dry-run-safe.ts";

/**
 * Round-trip props for Client Components — strips non-JSON values that break RSC serialization.
 */
export function serializeRoutingDryRunRowsForRsc(
  rows: RoutingDryRunDecisionView[]
): RoutingDryRunDecisionView[] {
  try {
    return JSON.parse(JSON.stringify(rows)) as RoutingDryRunDecisionView[];
  } catch {
    return rows.map((row) =>
      JSON.parse(JSON.stringify(row)) as RoutingDryRunDecisionView
    );
  }
}
