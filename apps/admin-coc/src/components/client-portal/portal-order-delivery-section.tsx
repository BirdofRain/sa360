import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatPortalDate } from "@/lib/client-portal/map-client-orders";
import {
  PORTAL_ORDER_DELIVERY_FINALIZING_COPY,
  PORTAL_ORDER_DELIVERY_LOAD_ERROR,
  PORTAL_ORDER_DELIVERY_READY_COPY,
  portalOrderDeliverySectionState,
  type PortalOrderDelivery,
} from "@/lib/client-portal/portal-order-deliveries";
import type { PortalOrderDetailView } from "@/lib/client-portal/map-client-orders";

function DeliveryRow({ delivery }: { delivery: PortalOrderDelivery }) {
  const released = formatPortalDate(delivery.releasedAt);
  const countLabel = `${delivery.leadCount.toLocaleString()} ${delivery.leadCount === 1 ? "lead" : "leads"}`;
  return (
    <li className="flex flex-col gap-3 border-t border-slate-100 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{delivery.displayFilename}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {released ? `Released ${released}` : "Released"}
          <span className="mx-1.5 text-slate-300">·</span>
          {countLabel}
        </p>
      </div>
      {delivery.downloadAvailable ? (
        <a
          href={delivery.downloadHref}
          className="inline-flex min-h-10 min-w-[44px] items-center justify-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          Download spreadsheet
        </a>
      ) : null}
    </li>
  );
}

export function PortalOrderDeliverySection({
  order,
  deliveries = [],
  deliveriesError = null,
}: {
  order: PortalOrderDetailView;
  deliveries?: PortalOrderDelivery[];
  deliveriesError?: string | null;
}) {
  const state = portalOrderDeliverySectionState({
    status: order.status,
    fulfillmentAvailable: order.fulfillmentAvailable,
    deliveries,
    deliveriesError,
  });
  if (state === "hidden") return null;

  return (
    <SectionPanel title="Delivery">
      <div className="space-y-3 p-4" data-testid="portal-order-delivery">
        {state === "error" ? (
          <p className="text-sm text-slate-600">{PORTAL_ORDER_DELIVERY_LOAD_ERROR}</p>
        ) : null}
        {state === "finalizing" ? (
          <p className="text-sm text-slate-700">{PORTAL_ORDER_DELIVERY_FINALIZING_COPY}</p>
        ) : null}
        {state === "ready" ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-900">{PORTAL_ORDER_DELIVERY_READY_COPY}</p>
            <ul>
              {deliveries.map((delivery) => (
                <DeliveryRow key={delivery.id} delivery={delivery} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionPanel>
  );
}
