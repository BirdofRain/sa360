"use client";

import { ActionCenterActiveLeads } from "@/components/action-center/action-center-active-leads";
import { ActionCenterAiFeed } from "@/components/action-center/action-center-ai-feed";
import { ActionCenterGhlCard } from "@/components/action-center/action-center-ghl-card";
import { ActionCenterHeader } from "@/components/action-center/action-center-header";
import { ActionCenterKpiRow } from "@/components/action-center/action-center-kpi-row";
import { ActionCenterPriorityList } from "@/components/action-center/action-center-priority-list";
import { ActionCenterSetupWarnings } from "@/components/action-center/action-center-setup-warnings";
import type { ActionCenterDashboardResponse } from "@/lib/action-center/types";

export type ActionCenterAppProps = {
  dashboard: ActionCenterDashboardResponse;
  setupWarnings: string[];
};

export function ActionCenterApp({ dashboard: data, setupWarnings }: ActionCenterAppProps) {
  const agentName = data.agentDisplayName ?? "Agent";

  return (
    <div className="min-h-dvh bg-slate-100/90">
      <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
        <ActionCenterHeader agentDisplayName={agentName} generatedAt={data.generatedAt} />

        <ActionCenterSetupWarnings warnings={setupWarnings} />

        <ActionCenterGhlCard connection={data.ghlConnection} />

        <ActionCenterKpiRow kpis={data.kpis} />

        <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7">
            <ActionCenterPriorityList
              items={data.priorityCalls}
              locationId={data.ghlConnection.locationId || data.locationId}
            />
          </div>
          <div className="space-y-4 lg:col-span-5">
            <ActionCenterActiveLeads
              leads={data.activeLeads}
              clientAccountId={data.clientAccountId}
              locationId={data.ghlConnection.locationId || data.locationId}
              agentDisplayName={data.agentDisplayName}
            />
            <ActionCenterAiFeed items={data.aiActivityFeed} />
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-400">
          Live API · What Happened? writes to SA360 · GHL writeback disabled
        </p>
      </div>
    </div>
  );
}