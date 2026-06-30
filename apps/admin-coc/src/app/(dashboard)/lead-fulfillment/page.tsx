import {
  AlertTriangle,
  ClipboardCheck,
  Inbox,
  Package,
  PackageCheck,
  Send,
  ShieldAlert,
} from "lucide-react";

import { FulfillmentActivityList } from "@/components/lead-fulfillment/fulfillment-activity-list";
import { LeadFulfillmentStatGrid } from "@/components/lead-fulfillment/lead-fulfillment-stat-card";
import { ProofStatusCard } from "@/components/lead-fulfillment/proof-status-card";
import { RecentLeadIntakeTable } from "@/components/lead-fulfillment/recent-lead-intake-table";
import { RoadmapBoundaryCard } from "@/components/lead-fulfillment/roadmap-boundary-card";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { getLeadFulfillmentOverviewData } from "@/lib/lead-fulfillment/mock-overview-data";

export const dynamic = "force-dynamic";

const KPI_ICONS = {
  leadsReceived: Inbox,
  proofAttached: ClipboardCheck,
  needsReview: ShieldAlert,
  availableInventory: Package,
  activeOrders: PackageCheck,
  deliveredLeads: Send,
  deliveryFailures: AlertTriangle,
} as const;

export default function LeadFulfillmentOverviewPage() {
  const data = getLeadFulfillmentOverviewData();

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

      <WarningBanner tone="info" title="Demo data">
        KPIs, proof summary, intake rows, and activity events are static mock data for LF1 UI
        scaffolding. Replace with Lead Fulfillment API wiring when available.
      </WarningBanner>

      <LeadFulfillmentStatGrid kpis={data.kpis} icons={KPI_ICONS} />

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
