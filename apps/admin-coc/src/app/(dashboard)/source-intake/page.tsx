import Link from "next/link";

import { SourceIntakeView } from "@/components/source-intake/source-intake-view";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import {
  fetchAdminDeliveryRuntimeMode,
  fetchAdminSourceLeads,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import {
  parseSourceIntakeSearchParams,
  sourceIntakePageHref,
  sourceIntakeToApiParams,
} from "@/lib/source-intake/source-intake-query";

export default async function SourceIntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = parseSourceIntakeSearchParams(sp);
  const configured = isAdminApiConfigured();
  const apiParams = sourceIntakeToApiParams(query);
  const { items, nextCursor, error } = await fetchAdminSourceLeads(apiParams);
  const nextHref = nextCursor ? sourceIntakePageHref(query, { cursor: nextCursor }) : null;
  const { data: runtimeMode } = configured
    ? await fetchAdminDeliveryRuntimeMode()
    : { data: null };

  const emptyHint =
    configured && !error
      ? items.length === 0
        ? "No source leads match these filters."
        : null
      : null;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Source Intake Queue</h1>
          <Badge variant="outline">REVIEW BEFORE DELIVERY</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          LeadCapture.io, Facebook Lead Ads direct intake, vendor imports, and future sources — normalized, routed,
          awaiting operator approval. Filter Facebook leads with <span className="font-mono">?provider=facebook</span>.
        </p>
      </div>

      <WarningBanner tone="info" title="No automatic GHL delivery">
        Webhooks and imports store leads here first. Approve simulation or one live delivery only after routing
        match and duplicate review.
      </WarningBanner>

      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to load source leads.
        </WarningBanner>
      ) : null}

      {configured && error ? (
        <WarningBanner tone="warn" title="Source intake unavailable">
          {error}
        </WarningBanner>
      ) : null}

      <SourceIntakeView items={items} emptyHint={emptyHint} runtimeMode={runtimeMode} />

      {nextHref ? (
        <div className="flex justify-end">
          <Link
            href={nextHref}
            className="text-sm font-medium text-slate-800 underline underline-offset-4 hover:underline"
            data-testid="source-intake-next"
          >
            Next
          </Link>
        </div>
      ) : null}
    </div>
  );
}
