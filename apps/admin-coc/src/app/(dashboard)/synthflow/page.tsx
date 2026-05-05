import { Suspense } from "react";

import { SynthflowMonitorFilters } from "@/components/dashboard/synthflow-monitor-filters";
import { SynthflowMonitorTable } from "@/components/dashboard/synthflow-monitor-table";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { fetchAdminSynthflowRequests, isAdminApiConfigured } from "@/lib/admin-api/server";
import {
  parseSynthflowMonitorSearchParams,
  synthflowMonitorToAdminApiParams,
} from "@/lib/synthflow-monitor-query";

export default async function SynthflowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = parseSynthflowMonitorSearchParams(sp);
  const configured = isAdminApiConfigured();

  const { items, error } = configured
    ? await fetchAdminSynthflowRequests(synthflowMonitorToAdminApiParams(query))
    : { items: [], error: null };

  const emptyHint =
    configured && error
      ? "Unable to load rows — see message above."
      : configured && !error && items.length === 0
        ? "No Synthflow requests match these filters."
        : null;

  return (
    <div className="space-y-4">
      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY (or ADMIN_API_KEY) to load Synthflow requests. The admin key
          stays server-only.
        </WarningBanner>
      ) : null}

      {configured && error ? (
        <WarningBanner tone="warn" title="Synthflow request log unavailable">
          {error}
        </WarningBanner>
      ) : null}

      <Suspense
        fallback={<div className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-50" aria-hidden />}
      >
        <SynthflowMonitorFilters initial={query} />
      </Suspense>

      <SynthflowMonitorTable items={items} emptyHint={emptyHint} />
    </div>
  );
}
