import { Suspense } from "react";

import { SynthflowMonitorFilters } from "@/components/dashboard/synthflow-monitor-filters";
import { SynthflowMonitorTable } from "@/components/dashboard/synthflow-monitor-table";
import { SynthflowOutboundMonitorFilters } from "@/components/dashboard/synthflow-outbound-monitor-filters";
import { SynthflowOutboundResultsTable } from "@/components/dashboard/synthflow-outbound-results-table";
import { SynthflowVoiceMonitorTabNav } from "@/components/dashboard/synthflow-voice-monitor-tab-nav";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import {
  fetchAdminSynthflowOutboundResults,
  fetchAdminSynthflowRequests,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import {
  applySynthflowTestDevClientFilter,
  parseSynthflowMonitorSearchParams,
  synthflowMonitorToAdminApiParams,
} from "@/lib/synthflow-monitor-query";
import {
  applyOutboundBookedClientFilter,
  buildSynthflowVoiceMonitorHref,
  parseSynthflowOutboundMonitorSearchParams,
  parseSynthflowVoiceMonitorTab,
  synthflowOutboundMonitorToAdminApiParams,
} from "@/lib/synthflow-outbound-monitor-query";

export default async function SynthflowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = parseSynthflowVoiceMonitorTab(sp);
  const requestsHref = buildSynthflowVoiceMonitorHref(sp, "requests");
  const outboundHref = buildSynthflowVoiceMonitorHref(sp, "outbound");

  const query = parseSynthflowMonitorSearchParams(sp);
  const outboundQuery = parseSynthflowOutboundMonitorSearchParams(sp);
  const configured = isAdminApiConfigured();

  const requestsFetch =
    configured && tab === "requests"
      ? await fetchAdminSynthflowRequests(synthflowMonitorToAdminApiParams(query))
      : { items: [], nextCursor: null, error: null as string | null };

  const outboundFetch =
    configured && tab === "outbound"
      ? await fetchAdminSynthflowOutboundResults(synthflowOutboundMonitorToAdminApiParams(outboundQuery))
      : { items: [], nextCursor: null, error: null as string | null };

  const apiItems = requestsFetch.items;
  const items = applySynthflowTestDevClientFilter(apiItems, query.testDev);

  const outboundApiItems = outboundFetch.items;
  const outboundItems = applyOutboundBookedClientFilter(outboundApiItems, outboundQuery.booked);

  const emptyHintRequests =
    configured && requestsFetch.error
      ? "Unable to load rows — see message above."
      : configured && !requestsFetch.error && items.length === 0
        ? apiItems.length > 0 && query.testDev
          ? query.testDev === "only"
            ? "No rows in this page match the test/dev heuristics. Try clearing “Test/dev only” or widening API filters."
            : "All rows on this page matched test/dev heuristics — try “Test/dev only” or clear “Hide test/dev”."
          : "No Synthflow requests match these filters."
        : null;

  const emptyHintOutbound = !configured
    ? "Outbound result endpoint not configured — set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY (or ADMIN_API_KEY)."
    : outboundFetch.error
      ? "Unable to load rows — see message above."
      : outboundItems.length === 0
        ? outboundApiItems.length > 0 && outboundQuery.booked
          ? "No rows on this page match the booked filter. Try “Any” or widen other filters."
          : "No outbound results yet."
        : null;

  return (
    <div className="space-y-4">
      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY (or ADMIN_API_KEY) to load Synthflow request logs and outbound
          results. The admin key stays server-only (never NEXT_PUBLIC_*).
        </WarningBanner>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SynthflowVoiceMonitorTabNav requestsHref={requestsHref} outboundHref={outboundHref} active={tab} />
      </div>

      {tab === "requests" && configured && requestsFetch.error ? (
        <WarningBanner tone="warn" title="Synthflow request log unavailable">
          {requestsFetch.error}
        </WarningBanner>
      ) : null}

      {tab === "outbound" && configured && outboundFetch.error ? (
        <WarningBanner tone="warn" title="Synthflow outbound results unavailable">
          {outboundFetch.error}
        </WarningBanner>
      ) : null}

      {tab === "requests" ? (
        <>
          <Suspense
            fallback={<div className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-50" aria-hidden />}
          >
            <SynthflowMonitorFilters initial={query} />
          </Suspense>

          <SynthflowMonitorTable items={items} emptyHint={emptyHintRequests} />
        </>
      ) : (
        <>
          <Suspense
            fallback={<div className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-50" aria-hidden />}
          >
            <SynthflowOutboundMonitorFilters initial={outboundQuery} />
          </Suspense>

          <SynthflowOutboundResultsTable items={outboundItems} emptyHint={emptyHintOutbound} />
        </>
      )}
    </div>
  );
}
