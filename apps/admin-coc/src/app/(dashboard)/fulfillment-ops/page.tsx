import { FulfillmentOpsWorkbench } from "@/components/fulfillment-ops/fulfillment-ops-workbench";
import { loadFulfillmentOpsPageData } from "@/lib/fulfillment-ops/fulfillment-ops-api";
import { loadProvenanceImpactPanel } from "@/lib/fulfillment-ops/provenance-impact-api";

export const dynamic = "force-dynamic";

export default async function FulfillmentOpsPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const params = await searchParams;
  const orderId = params.orderId?.trim() || null;
  const [{ bootstrap, orders, clients, pricingCatalog, pricingError, loadError }, provenanceImpact] =
    await Promise.all([loadFulfillmentOpsPageData(orderId), loadProvenanceImpactPanel()]);

  return (
    <FulfillmentOpsWorkbench
      bootstrap={bootstrap}
      orders={orders}
      clients={clients}
      pricingCatalog={pricingCatalog}
      pricingError={pricingError}
      loadError={loadError}
      initialOrderId={orderId}
      provenanceImpact={provenanceImpact}
    />
  );
}
