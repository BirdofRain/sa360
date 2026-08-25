"use client";

import { Suspense } from "react";

import type { PortalAccountSnapshot } from "@/lib/client-portal/map-client-summary";
import type { ClientPortalDashboard } from "@/lib/client-portal/types";

import { AiVoiceCard } from "./ai-voice-card";
import { AppointmentsAttentionList } from "./appointments-attention-list";
import { FunnelConversionBar } from "./funnel-conversion-bar";
import { LeadFunnelCard } from "./lead-funnel-card";
import { LeadSourcesCard } from "./lead-sources-card";
import { PortalAccountSnapshot as AccountSnapshot } from "./portal-account-snapshot";
import { PortalHeader } from "./portal-header";
import { PortalUnavailableState } from "./portal-unavailable-state";
import { RecentActivityFeed } from "./recent-activity-feed";
import { SystemHealthCard } from "./system-health-card";

export function ClientPortalShell({
  dashboard,
  snapshot,
}: {
  dashboard: ClientPortalDashboard | null;
  snapshot?: PortalAccountSnapshot | null;
}) {
  return (
    <div className="space-y-6">
      {dashboard ? (
        <Suspense
          fallback={
            <div className="h-20 animate-pulse rounded-xl bg-slate-200/60" aria-hidden />
          }
        >
          <PortalHeader
            displayName={dashboard.client.displayName}
            locationLabel={dashboard.client.locationLabel}
            nicheLabels={dashboard.client.nicheLabels}
            productLabels={dashboard.client.productLabels}
            rangeLabel={dashboard.range.label}
            rangeKey={dashboard.range.key}
            generatedAt={dashboard.generatedAt}
          />
        </Suspense>
      ) : (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Performance overview
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Overview</h1>
          <p className="mt-1 text-sm text-slate-500">
            Live metrics are unavailable for this period.
          </p>
        </div>
      )}

      {snapshot ? <AccountSnapshot snapshot={snapshot} /> : null}

      {dashboard ? (
        <>
          <SystemHealthCard health={dashboard.systemHealth} />
          <LeadFunnelCard funnel={dashboard.funnel} />
          <FunnelConversionBar funnel={dashboard.funnel} />
          <div className="grid gap-6 lg:grid-cols-2">
            <RecentActivityFeed items={dashboard.recentActivity} />
            <AppointmentsAttentionList items={dashboard.appointmentsNeedingAttention} />
          </div>
          <LeadSourcesCard sources={dashboard.leadSources} />
          <AiVoiceCard aiVoice={dashboard.aiVoice} />
        </>
      ) : (
        <PortalUnavailableState
          title="Performance metrics unavailable"
          hint="We could not load your funnel, activity, or source breakdown. Use Orders, Leads, and Account for the latest information we do have, or try again shortly."
        />
      )}
    </div>
  );
}
