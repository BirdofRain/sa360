import { RoutingDryRunFilters } from "@/components/dashboard/routing-dry-run-filters";
import { RoutingDryRunStatsCards } from "@/components/dashboard/routing-dry-run-stats-cards";
import { RoutingDryRunTable } from "@/components/dashboard/routing-dry-run-table";
import { RoutingDryRunTestPanel } from "@/components/dashboard/routing-dry-run-test-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { loadRoutingDryRunPageData } from "@/lib/routing-dry-run/routing-dry-run-page-loader";
import { ROUTING_DRY_RUN_ACTION_FAILED } from "@/lib/routing-dry-run/routing-dry-run-safe";

export default async function RoutingDryRunPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    return await RoutingDryRunPageContent(await searchParams);
  } catch (err) {
    const message = err instanceof Error ? err.message : ROUTING_DRY_RUN_ACTION_FAILED;
    return (
      <div className="space-y-4">
        <WarningBanner tone="warn" title="Routing dry-run page failed to load">
          {ROUTING_DRY_RUN_ACTION_FAILED}
          <span className="mt-2 block font-mono text-xs text-muted-foreground">{message}</span>
        </WarningBanner>
      </div>
    );
  }
}

async function RoutingDryRunPageContent(
  sp: Record<string, string | string[] | undefined>
) {
  const loaded = await loadRoutingDryRunPageData(sp);
  const {
    query,
    configured,
    hasMasterFilter,
    masterClientOptions,
    masterClientsError,
    decisionsError,
    statsError,
    globalStats,
    items,
    emptyHint,
    loadWarnings,
  } = loaded;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Routing Dry Run</h1>
            <Badge
              variant="outline"
              className="border-violet-600/40 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100"
            >
              DRY RUN ONLY
            </Badge>
            {query.safeMode ? (
              <Badge variant="outline" className="border-amber-600/40 bg-amber-50 text-amber-950">
                SAFE MODE
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare SA360 routing and shadow delivery plans against legacy Zapier / GHL delivery.
          </p>
        </div>
      </div>

      <WarningBanner tone="info" title="Dry-run, shadow delivery & legacy comparison only">
        Dry-run routing, shadow delivery plans, and operator validation do not create contacts, start
        workflows, write sheets, or replace legacy delivery.
      </WarningBanner>

      {query.safeMode ? (
        <WarningBanner tone="info" title="Safe mode">
          Loading up to {query.limit} decisions without global stats. Use filters to return to full view.
        </WarningBanner>
      ) : null}

      {loadWarnings.map((w) => (
        <p key={w} className="text-xs text-muted-foreground">
          {w}
        </p>
      ))}

      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY (or ADMIN_API_KEY) to load routing dry-run
          decisions.
        </WarningBanner>
      ) : null}

      {configured && masterClientsError ? (
        <WarningBanner tone="warn" title="Master client list unavailable">
          {masterClientsError}
        </WarningBanner>
      ) : null}

      {configured && !hasMasterFilter && !query.safeMode ? (
        <WarningBanner tone="info" title="All master clients">
          Showing dry-run decisions across every configured lead source. Select a specific master to load
          global stats.
        </WarningBanner>
      ) : null}

      {configured && decisionsError ? (
        <WarningBanner tone="warn" title="Routing dry-run decisions unavailable">
          {decisionsError.includes("Admin API") ? ROUTING_DRY_RUN_ACTION_FAILED : decisionsError}
        </WarningBanner>
      ) : null}

      <RoutingDryRunFilters initial={query} masterClientOptions={masterClientOptions} />

      {hasMasterFilter && !query.safeMode ? (
        <RoutingDryRunStatsCards stats={globalStats} statsError={statsError} />
      ) : null}

      {hasMasterFilter && query.safeMode && statsError ? (
        <p className="text-xs text-muted-foreground">Global stats skipped in safe mode.</p>
      ) : null}

      <RoutingDryRunTestPanel masterClientOptions={masterClientOptions} />

      <RoutingDryRunTable items={items} emptyHint={emptyHint} skipNormalize />
    </div>
  );
}
