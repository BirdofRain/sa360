import { StatTile } from "@/components/dashboard/stat-tile";
import {
  computeRoutingDryRunPageStats,
  type RoutingDryRunPageStats,
} from "@/lib/routing-dry-run/routing-dry-run-stats";
import type { RoutingDryRunDecisionItem } from "@/lib/routing-dry-run/types";

export function RoutingDryRunStatsCards({
  items,
  stats: statsOverride,
}: {
  items: RoutingDryRunDecisionItem[];
  stats?: RoutingDryRunPageStats;
}) {
  const stats = statsOverride ?? computeRoutingDryRunPageStats(items);
  const hint = `From ${items.length} loaded row${items.length === 1 ? "" : "s"}`;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatTile label="Matched predictions" value={stats.matchedPredictions} tone="good" hint={hint} />
      <StatTile label="Review required" value={stats.reviewRequired} tone="warn" hint={hint} />
      <StatTile
        label="Validated matched legacy"
        value={stats.validatedMatchedLegacy}
        tone="good"
        hint={hint}
      />
      <StatTile label="Mismatches" value={stats.mismatches} tone="bad" hint={hint} />
      <StatTile label="Needs mapping" value={stats.needsMapping} tone="warn" hint={hint} />
    </div>
  );
}
