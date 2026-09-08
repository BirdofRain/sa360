import { SectionPanel } from "@/components/dashboard/section-panel";
import type { PortalOrderDetailView } from "@/lib/client-portal/map-client-orders";
import {
  portalFulfillmentPrimarySummary,
  portalFulfillmentProgressPercent,
  portalFulfillmentStatusLabel,
  portalFulfillmentStatusTone,
} from "@/lib/client-portal/portal-order-fulfillment";

import { PortalStatusPill } from "./portal-status-pill";

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

export function PortalOrderFulfillmentSection({
  order,
}: {
  order: PortalOrderDetailView;
}) {
  const fulfillment =
    order.fulfillmentAvailable && order.fulfillment ? order.fulfillment : null;

  return (
    <SectionPanel title="Lead delivery">
      <div className="min-w-0 space-y-4 overflow-x-hidden p-4">
        {fulfillment ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">
                {portalFulfillmentPrimarySummary(fulfillment)}
              </p>
              <PortalStatusPill
                label={portalFulfillmentStatusLabel(fulfillment.status)}
                tone={portalFulfillmentStatusTone(fulfillment.status)}
              />
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Count label="Ordered" value={fulfillment.requestedQuantity} />
              <Count label="Delivered" value={fulfillment.fulfilledQuantity} />
              <Count label="Remaining" value={fulfillment.remainingQuantity} />
            </dl>
            <div className="min-w-0 space-y-1.5">
              <div
                className="h-2 w-full max-w-full overflow-hidden rounded-full bg-slate-200"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(portalFulfillmentProgressPercent(fulfillment))}
                aria-label={portalFulfillmentPrimarySummary(fulfillment)}
              >
                <div
                  className="h-full max-w-full rounded-full bg-emerald-500"
                  style={{ width: `${portalFulfillmentProgressPercent(fulfillment)}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Delivery progress is not available yet.</p>
        )}
      </div>
    </SectionPanel>
  );
}
