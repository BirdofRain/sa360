import {
  AlertTriangle,
  ClipboardCheck,
  Inbox,
  Package,
  PackageCheck,
  Send,
  ShieldAlert,
} from "lucide-react";

import { LeadFulfillmentOverviewContent } from "@/components/lead-fulfillment/lead-fulfillment-overview-content";
import { loadLeadFulfillmentOverviewPageData } from "@/lib/lead-fulfillment/lead-fulfillment-api";

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

export default async function LeadFulfillmentOverviewPage() {
  const { data, dataSource, loadError, dataLimitations } =
    await loadLeadFulfillmentOverviewPageData();

  return (
    <LeadFulfillmentOverviewContent
      data={data}
      dataSource={dataSource}
      loadError={loadError}
      dataLimitations={dataLimitations}
      kpiIcons={KPI_ICONS}
    />
  );
}
