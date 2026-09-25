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
          Campaign intake, inventory lifecycle, priced fulfillment, and scoped proof/verification
        </p>
      </header>

      <LeadFulfillmentDataBanners
        dataSource={dataSource}
        data={data}
        loadError={loadError}
        dataLimitations={dataLimitations}
      />

      {data.campaignHelpText ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {data.campaignHelpText}
        </p>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Fresh (0–9 UTC days, any status) and Blocked / Review (pending_review, any age) overlap.
          Recent intake is the latest 25 SourceLeadEvent rows and is not the Aged available count.
        </p>
      )}

      <LeadFulfillmentStatGrid
        title="Lead intake"
        helpText="SourceLeadEvent intake count. Not comparable to proof-vault or verification populations."
        kpis={data.kpis.filter((kpi) => kpi.group === "intake" || kpi.key === "leadsReceived")}
        icons={kpiIcons}
      />
      <LeadFulfillmentStatGrid
        title="Inventory"
        helpText="SQL-side LeadInventoryItem counts. Fresh is 0–9 UTC days, any status. Blocked / Review is pending_review, any age. Those two overlap. Aged available is status available, at least 30 UTC days, not commerce-excluded. Recent intake is a separate 25-row SourceLeadEvent sample. Timestamps are UTC."
        kpis={data.kpis.filter(
          (kpi) =>
            kpi.group === "inventory" ||
            ["inventoryTracked", "freshHold", "semiFreshHold", "agedAvailable", "reserved", "blockedReview"].includes(
              kpi.key
            )
        )}
        icons={kpiIcons}
      />
      <LeadFulfillmentStatGrid
        title="Fulfillment"
        helpText="Active priced LeadOrder rows. Buyer deliveries count BuyerDeliveredIdentity records (buyer-scoped; the same consumer can appear more than once). CSV download is not a delivery."
        kpis={data.kpis.filter(
          (kpi) =>
            kpi.group === "fulfillment" ||
            ["activeOrders", "deliveredLeads", "deliveryFailures"].includes(kpi.key)
        )}
        icons={kpiIcons}
      />

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
