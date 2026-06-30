import type { LucideIcon } from "lucide-react";

import { FulfillmentActivityList } from "@/components/lead-fulfillment/fulfillment-activity-list";
import { LeadFulfillmentDataBanners } from "@/components/lead-fulfillment/lead-fulfillment-data-banners";
import { LeadFulfillmentStatGrid } from "@/components/lead-fulfillment/lead-fulfillment-stat-card";
import { ProofStatusCard } from "@/components/lead-fulfillment/proof-status-card";
import { RecentLeadIntakeTable } from "@/components/lead-fulfillment/recent-lead-intake-table";
import { RoadmapBoundaryCard } from "@/components/lead-fulfillment/roadmap-boundary-card";
import type { LeadFulfillmentOverviewData } from "@/lib/lead-fulfillment/types";

export function LeadFulfillmentOverviewContent({
  data,
  dataSource,
  loadError,
  dataLimitations,
  kpiIcons,
}: {
  data: LeadFulfillmentOverviewData;
  dataSource: "live" | "mock";
  loadError: string | null;
  dataLimitations: string[];
  kpiIcons: Partial<
    Record<
      LeadFulfillmentOverviewData["kpis"][number]["key"],
      LucideIcon
    >
  >;
}) {
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Lead Fulfillment Overview
        </h1>
        <p className="text-sm text-slate-500">
          LF1 intake, proof, verification, inventory, orders, and fulfillment activity
        </p>
      </header>

      <LeadFulfillmentDataBanners
        dataSource={dataSource}
        data={data}
        loadError={loadError}
        dataLimitations={dataLimitations}
      />

      <LeadFulfillmentStatGrid kpis={data.kpis} icons={kpiIcons} />

      <ProofStatusCard items={data.proofSummary} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentLeadIntakeTable rows={data.recentIntake} />
        </div>
        <FulfillmentActivityList events={data.activity} />
      </div>

      <RoadmapBoundaryCard />
    </div>
  );
}
