import { StatTile } from "@/components/dashboard/stat-tile";
import type { RoutingDryRunStats } from "@/lib/routing-dry-run/types";

function pct(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

export function RoutingDryRunStatsCards({
  stats,
  statsError,
}: {
  stats: RoutingDryRunStats | null;
  statsError?: string | null;
}) {
  if (!stats) {
    return statsError ? (
      <p className="rounded-md border border-amber-600/30 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        Global stats unavailable: {statsError}
      </p>
    ) : null;
  }

  const hint = `All decisions for ${stats.masterClientAccountId}`;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Global stats (all matching decisions in database)</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <StatTile label="Total decisions" value={stats.totalDecisions} hint={hint} />
        <StatTile label="Matched predictions" value={stats.matched} tone="good" hint={hint} />
        <StatTile label="Review required" value={stats.reviewRequired} tone="warn" hint={hint} />
        <StatTile label="Match rate" value={pct(stats.matchRate)} tone="good" hint={hint} />
        <StatTile
          label="Validated matched legacy"
          value={stats.validatedMatchedLegacy}
          tone="good"
          hint={hint}
        />
        <StatTile label="Mismatches" value={stats.mismatches} tone="bad" hint={hint} />
        <StatTile label="Needs mapping" value={stats.needsMapping} tone="warn" hint={hint} />
        <StatTile label="Unreviewed" value={stats.unreviewed} hint={hint} />
        <StatTile label="Validation coverage" value={pct(stats.validationCoverage)} hint={hint} />
        <StatTile label="Shadow plans generated" value={stats.generatedPlans} hint={hint} />
        <StatTile label="Plans needs config" value={stats.needsConfigPlans} tone="warn" hint={hint} />
        <StatTile label="Legacy unknown" value={stats.legacyUnknown} hint={hint} />
      </div>
    </div>
  );
}
