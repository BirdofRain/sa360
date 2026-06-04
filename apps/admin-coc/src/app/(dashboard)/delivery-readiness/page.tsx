import { DeliveryReadinessFilters } from "@/components/dashboard/delivery-readiness-filters";
import { DeliveryReadinessTable } from "@/components/dashboard/delivery-readiness-table";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { fetchAdminDeliveryReadiness, isAdminApiConfigured } from "@/lib/admin-api/server";
import {
  applyDeliveryReadinessDefaultMaster,
  deliveryReadinessQueryToApiParams,
  parseDeliveryReadinessSearchParams,
} from "@/lib/delivery-readiness/delivery-readiness-query";
import { ROUTING_DRY_RUN_ACTION_FAILED } from "@/lib/routing-dry-run/routing-dry-run-safe";

export default async function DeliveryReadinessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = applyDeliveryReadinessDefaultMaster(parseDeliveryReadinessSearchParams(sp));

  const configured = isAdminApiConfigured();
  const apiParams = deliveryReadinessQueryToApiParams(query);

  let data: Awaited<ReturnType<typeof fetchAdminDeliveryReadiness>>["data"] = null;
  let error: string | null = null;
  if (configured && apiParams) {
    try {
      const res = await fetchAdminDeliveryReadiness(apiParams);
      data = res.data;
      error = res.error;
    } catch {
      error = ROUTING_DRY_RUN_ACTION_FAILED;
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Delivery Readiness</h1>
          <Badge variant="outline" className="border-amber-600/40 bg-amber-50 text-amber-950">
            CONFIG ONLY
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Review guarded live-delivery readiness per routing rule. No GHL contacts, workflows, or sheets are
          modified from this page.
        </p>
      </div>

      <WarningBanner tone="info" title="Shadow and readiness only">
        Enabling delivery flags records operator intent only. Live delivery execution is not active in this
        phase. Use Routing Dry Run for shadow plans and legacy validation.
      </WarningBanner>

      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to load delivery readiness.
        </WarningBanner>
      ) : null}

      {!apiParams ? (
        <WarningBanner tone="info" title="Filter required">
          Enter a master client account ID or destination client account ID, or set{" "}
          <span className="font-mono">NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID</span>.
        </WarningBanner>
      ) : null}

      {configured && error ? (
        <WarningBanner tone="warn" title="Delivery readiness unavailable">
          {error}
        </WarningBanner>
      ) : null}

      <DeliveryReadinessFilters initial={query} />

      <DeliveryReadinessTable
        items={items}
        initialRuleId={query.ruleId}
        emptyHint={
          apiParams
            ? "No routing rules match this filter."
            : "Enter a master or client account ID to load rules."
        }
      />
    </div>
  );
}
