import { DeliveryReadinessFilters } from "@/components/dashboard/delivery-readiness-filters";
import { DeliveryReadinessTable } from "@/components/dashboard/delivery-readiness-table";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { fetchAdminDeliveryReadiness, isAdminApiConfigured } from "@/lib/admin-api/server";
import {
  deliveryReadinessQueryToApiParams,
  getDeliveryReadinessDefaultMasterClientAccountId,
  parseDeliveryReadinessSearchParams,
} from "@/lib/delivery-readiness/delivery-readiness-query";

export default async function DeliveryReadinessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  let query = parseDeliveryReadinessSearchParams(sp);
  if (!query.masterClientAccountId.trim()) {
    const def = getDeliveryReadinessDefaultMasterClientAccountId();
    if (def) query = { ...query, masterClientAccountId: def };
  }

  const configured = isAdminApiConfigured();
  const apiParams = deliveryReadinessQueryToApiParams(query);
  const { data, error } =
    configured && apiParams
      ? await fetchAdminDeliveryReadiness(apiParams)
      : { data: null, error: null as string | null };

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
          Enter a master client account ID or destination client account ID.
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
        emptyHint={
          apiParams
            ? "No routing rules match this filter."
            : "Enter a master or client account ID to load rules."
        }
      />
    </div>
  );
}
