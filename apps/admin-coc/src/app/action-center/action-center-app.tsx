"use client";

import { ActionCenterActiveLeads } from "@/components/action-center/action-center-active-leads";
import { ActionCenterAiFeed } from "@/components/action-center/action-center-ai-feed";
import { ActionCenterGhlCard } from "@/components/action-center/action-center-ghl-card";
import { ActionCenterHeader } from "@/components/action-center/action-center-header";
import { ActionCenterKpiRow } from "@/components/action-center/action-center-kpi-row";
import { ActionCenterPriorityList } from "@/components/action-center/action-center-priority-list";
import { ActionCenterSetupWarnings } from "@/components/action-center/action-center-setup-warnings";
import { SectionErrorBoundary } from "@/components/dashboard/section-error-boundary";
import type {
  ActionCenterDashboardResponse,
  ActionCenterSectionAvailability,
} from "@/lib/action-center/types";

export type ActionCenterAppProps = {
  dashboard: ActionCenterDashboardResponse;
  setupWarnings: string[];
  sections?: ActionCenterSectionAvailability;
};

const DEFAULT_SECTIONS: ActionCenterSectionAvailability = {
  ghlConnection: "ok",
  kpis: "ok",
  priorityCalls: "ok",
  activeLeads: "ok",
  aiActivity: "ok",
  setupWarnings: "ok",
};

export function ActionCenterApp({
  dashboard: data,
  setupWarnings,
  sections = DEFAULT_SECTIONS,
}: ActionCenterAppProps) {
  const agentName = data.agentDisplayName ?? "Agent";

  return (
    <div className="min-h-dvh bg-slate-100/90">
      <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
        <ActionCenterHeader agentDisplayName={agentName} generatedAt={data.generatedAt} />

        <SectionErrorBoundary title="Setup notes">
          <ActionCenterSetupWarnings
            warnings={setupWarnings}
            availability={sections.setupWarnings}
          />
        </SectionErrorBoundary>

        <SectionErrorBoundary title="GHL connection">
          <ActionCenterGhlCard
            connection={data.ghlConnection}
            availability={sections.ghlConnection}
          />
        </SectionErrorBoundary>

        <SectionErrorBoundary title="KPI summary">
          <ActionCenterKpiRow kpis={data.kpis} availability={sections.kpis} />
        </SectionErrorBoundary>

        <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7">
            <SectionErrorBoundary title="Priority list">
              <ActionCenterPriorityList
                items={data.priorityCalls}
                locationId={data.ghlConnection.locationId || data.locationId}
                availability={sections.priorityCalls}
              />
            </SectionErrorBoundary>
          </div>
          <div className="space-y-4 lg:col-span-5">
            <SectionErrorBoundary title="Active leads">
              <ActionCenterActiveLeads
                leads={data.activeLeads}
                clientAccountId={data.clientAccountId}
                locationId={data.ghlConnection.locationId || data.locationId}
                agentDisplayName={data.agentDisplayName}
                availability={sections.activeLeads}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary title="AI activity">
              <ActionCenterAiFeed
                items={data.aiActivityFeed}
                availability={sections.aiActivity}
              />
            </SectionErrorBoundary>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-400">
          Live API · What Happened? writes to SA360 · GHL writeback disabled
        </p>
      </div>
    </div>
  );
}