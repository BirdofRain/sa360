import { RoutingDryRunFilters } from "@/components/dashboard/routing-dry-run-filters";
import { RoutingDryRunTable } from "@/components/dashboard/routing-dry-run-table";
import { RoutingDryRunTestPanel } from "@/components/dashboard/routing-dry-run-test-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { fetchAdminRoutingDryRunDecisions, isAdminApiConfigured } from "@/lib/admin-api/server";
import { routingDryRunEmptyHint } from "@/lib/routing-dry-run/routing-dry-run-empty-state";
import {
  getRoutingDryRunDefaultMasterClientAccountId,
  parseRoutingDryRunSearchParams,
  routingDryRunQueryToApiParams,
} from "@/lib/routing-dry-run/routing-dry-run-query";

export default async function RoutingDryRunPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  let query = parseRoutingDryRunSearchParams(sp);
  if (!query.masterClientAccountId.trim()) {
    const defaultMaster = getRoutingDryRunDefaultMasterClientAccountId();
    if (defaultMaster) {
      query = { ...query, masterClientAccountId: defaultMaster };
    }
  }

  const configured = isAdminApiConfigured();
  const apiParams = routingDryRunQueryToApiParams(query);
  const hasMaster = Boolean(apiParams?.masterClientAccountId);

  const { data, error } =
    configured && apiParams
      ? await fetchAdminRoutingDryRunDecisions(apiParams)
      : { data: null, error: null as string | null };

  const items = data?.items ?? [];
  const emptyHint = routingDryRunEmptyHint({
    configured,
    hasMaster,
    hasApiError: Boolean(error),
    itemCount: items.length,
    matchedFilter: query.matched,
  });

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
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Review how SA360 would route incoming leads before delivery is enabled.
          </p>
        </div>
      </div>

      <WarningBanner tone="info" title="Dry-run only — no delivery">
        Dry-run decisions do not create contacts, start workflows, write sheets, or replace legacy delivery.
      </WarningBanner>

      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY (or ADMIN_API_KEY) to load routing dry-run
          decisions.
        </WarningBanner>
      ) : null}

      {!hasMaster ? (
        <WarningBanner tone="info" title="Master client account required">
          Enter a <span className="font-mono">masterClientAccountId</span> to load decisions, or set{" "}
          <span className="font-mono">NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID</span> for a default
          filter in this environment.
        </WarningBanner>
      ) : null}

      {configured && error ? (
        <WarningBanner tone="warn" title="Routing dry-run decisions unavailable">
          {error}
        </WarningBanner>
      ) : null}

      <RoutingDryRunFilters initial={query} />

      <RoutingDryRunTestPanel />

      <RoutingDryRunTable items={items} emptyHint={emptyHint} />
    </div>
  );
}
