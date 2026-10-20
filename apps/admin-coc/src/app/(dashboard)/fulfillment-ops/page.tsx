import { FulfillmentOpsWorkbench } from "@/components/fulfillment-ops/fulfillment-ops-workbench";
import {
  loadHistoricalCampaignCensus,
  loadHistoricalOrderDrilldown,
} from "@/lib/fulfillment-ops/historical-campaign-census-api";
import { loadFulfillmentOpsPageData } from "@/lib/fulfillment-ops/fulfillment-ops-api";
import { loadProvenanceImpactPanel } from "@/lib/fulfillment-ops/provenance-impact-api";
import type {
  HistoricalCensusPanelModel,
  HistoricalOrderPanelModel,
} from "@/lib/fulfillment-ops/historical-campaign-census";

export const dynamic = "force-dynamic";

export default async function FulfillmentOpsPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; historicalCensus?: string; historicalOrder?: string }>;
}) {
  const params = await searchParams;
  const orderId = params.orderId?.trim() || null;
  const censusRequested = params.historicalCensus === "1";
  const requestedOrderNumber = params.historicalOrder?.trim() || null;
  const idleCensus: HistoricalCensusPanelModel = { state: "idle" };
  const idleOrder: HistoricalOrderPanelModel = { state: "idle" };
  const [{ bootstrap, orders, clients, pricingCatalog, pricingError, loadError }, provenanceImpact, historicalCensus, historicalOrder] =
    await Promise.all([
      loadFulfillmentOpsPageData(orderId),
      loadProvenanceImpactPanel(),
      censusRequested ? loadHistoricalCampaignCensus() : Promise.resolve(idleCensus),
      requestedOrderNumber ? loadHistoricalOrderDrilldown(requestedOrderNumber) : Promise.resolve(idleOrder),
    ]);

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
      historicalCensus={historicalCensus}
      historicalOrder={historicalOrder}
      fulfillmentOrderId={orderId}
      censusRequested={censusRequested}
      requestedOrderNumber={requestedOrderNumber}
    />
  );
}
