"use client";

import { Suspense } from "react";

import type { ClientPortalDashboard } from "@/lib/client-portal/types";
import { AiVoiceCard } from "./ai-voice-card";
import { AppointmentsAttentionList } from "./appointments-attention-list";
import { FunnelConversionBar } from "./funnel-conversion-bar";
import { LeadFunnelCard } from "./lead-funnel-card";
import { LeadSourcesCard } from "./lead-sources-card";
import { PortalHeader } from "./portal-header";
import { RecentActivityFeed } from "./recent-activity-feed";
import { SystemHealthCard } from "./system-health-card";

export function ClientPortalShell({
  dashboard,
  previewMode = false,
}: {
  dashboard: ClientPortalDashboard;
  previewMode?: boolean;
}) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-slate-100/80">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:py-10">
        <Suspense
          fallback={
            <div className="h-20 animate-pulse rounded-xl bg-slate-200/60" aria-hidden />
          }
        >
          <PortalHeader
            displayName={dashboard.client.displayName}
            locationLabel={dashboard.client.locationLabel}
            rangeLabel={dashboard.range.label}
            rangeKey={dashboard.range.key}
            generatedAt={dashboard.generatedAt}
          />
        </Suspense>

        {previewMode ? (
          <p className="rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2 text-center text-xs text-sky-800">
            Preview dashboard — sample data. Set CLIENT_PORTAL_API_KEY and API URL for live
            metrics.
          </p>
        ) : null}

        <SystemHealthCard health={dashboard.systemHealth} />

        <LeadFunnelCard funnel={dashboard.funnel} />

        <FunnelConversionBar funnel={dashboard.funnel} />

        <div className="grid gap-6 lg:grid-cols-2">
          <RecentActivityFeed items={dashboard.recentActivity} />
          <AppointmentsAttentionList items={dashboard.appointmentsNeedingAttention} />
        </div>

        <LeadSourcesCard sources={dashboard.leadSources} />

        <AiVoiceCard aiVoice={dashboard.aiVoice} />

        <footer className="pt-4 text-center text-xs text-slate-400">
          Powered by SA360 · Questions? Contact your account team.
        </footer>
      </div>
    </div>
  );
}
