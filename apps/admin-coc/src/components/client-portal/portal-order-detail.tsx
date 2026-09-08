import Link from "next/link";

import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import {
  formatPortalDate,
  portalOrderNextStep,
  portalOrderStatusLabel,
  portalOrderStatusTone,
  type PortalOrderDetailView,
} from "@/lib/client-portal/map-client-orders";
import type { PortalLeadView } from "@/lib/client-portal/map-client-leads";
import { formatPortalDisplayValue } from "@/lib/client-portal/portal-labels";
import {
  portalPaymentConfirmationLabel,
  portalPaymentConfirmationTone,
} from "@/lib/client-portal/portal-order-request";

import type { PortalOrderDelivery } from "@/lib/client-portal/portal-order-deliveries";

import { PortalOrderDeliverySection } from "./portal-order-delivery-section";
import { PortalOrderFulfillmentSection } from "./portal-order-fulfillment-section";
import { PortalOrderIdentity } from "./portal-order-identity";
import { PortalOrderLinkedLeads } from "./portal-order-linked-leads";
import { PortalStatusPill } from "./portal-status-pill";

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function hasAnyDate(order: PortalOrderDetailView): boolean {
  return [
    order.requestedStartDate,
    order.submittedAt,
    order.approvedAt,
    order.activatedAt,
    order.pausedAt,
    order.completedAt,
    order.canceledAt,
    order.createdAt,
    order.updatedAt,
  ].some((iso) => formatPortalDate(iso) !== null);
}

function DateLine({ label, iso }: { label: string; iso: string | null }) {
  const date = formatPortalDate(iso);
  if (!date || !iso) return null;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm text-slate-900">
        {date}
        <span className="ml-2 text-xs text-slate-400">{formatRelativeTime(iso)}</span>
      </span>
    </li>
  );
}

export function PortalOrderDetail({
  order,
  displayName,
  linkedLeads = [],
  linkedLeadsError = null,
  linkedLeadsHasMore = false,
  deliveries = [],
  deliveriesError = null,
}: {
  order: PortalOrderDetailView;
  displayName?: string | null;
  linkedLeads?: PortalLeadView[];
  linkedLeadsError?: string | null;
  linkedLeadsHasMore?: boolean;
  deliveries?: PortalOrderDelivery[];
  deliveriesError?: string | null;
}) {
  const orderedAt = formatPortalDate(order.submittedAt ?? order.createdAt);
  const volumeLabel = Number.isFinite(order.volume) ? order.volume.toLocaleString() : null;
  const nextStep = portalOrderNextStep(order);
  const paymentLabel = portalPaymentConfirmationLabel(order.paymentConfirmationStatus);
  const paymentTone = portalPaymentConfirmationTone(order.paymentConfirmationStatus);
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/portal/orders"
          className="inline-flex min-h-10 items-center text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
        >
          Back to Orders
        </Link>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Order</p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              <PortalOrderIdentity displayName={displayName} orderNumber={order.orderNumber} />
            </h1>
            {orderedAt ? (
              <p className="mt-1 text-sm text-slate-500">Ordered {orderedAt}</p>
            ) : null}
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <PortalStatusPill
              kind="order"
              label={portalOrderStatusLabel(order.status)}
              tone={portalOrderStatusTone(order.status)}
            />
            {paymentLabel && paymentTone ? (
              <PortalStatusPill kind="payment" label={paymentLabel} tone={paymentTone} />
            ) : null}
          </div>
        </div>
      </div>

      <SectionPanel title="Order summary">
        <dl className="grid gap-4 p-4 sm:grid-cols-2">
          <Fact label="Lead type" value={formatPortalDisplayValue(order.nicheLabel)} />
          <Fact label="Product" value={formatPortalDisplayValue(order.productLabel)} />
          <Fact label="Requested quantity" value={volumeLabel} />
          <Fact label="Order type" value={formatPortalDisplayValue(order.campaignType)} />
          <Fact label="Delivery cadence" value={formatPortalDisplayValue(order.deliveryCadence)} />
          <Fact label="Payment" value={paymentLabel} />
        </dl>
        {order.states.length > 0 ? (
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">States</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {order.states.map((state) => (
                <li
                  key={state}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                >
                  {state}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {order.notes ? (
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">Notes</p>
            <p className="mt-1 text-sm text-slate-800">{order.notes}</p>
          </div>
        ) : null}
      </SectionPanel>

      <PortalOrderFulfillmentSection order={order} />

      <PortalOrderDeliverySection
        order={order}
        deliveries={deliveries}
        deliveriesError={deliveriesError}
      />

      <PortalOrderLinkedLeads
        leads={linkedLeads}
        error={linkedLeadsError}
        hasMore={linkedLeadsHasMore}
      />

      <SectionPanel title="What happens next">
        <p className="p-4 text-sm text-slate-700">{nextStep}</p>
      </SectionPanel>

      {hasAnyDate(order) ? (
        <SectionPanel title="Dates">
          <ul className="divide-y divide-slate-100 px-4">
            <DateLine label="Requested start" iso={order.requestedStartDate} />
            <DateLine label="Submitted" iso={order.submittedAt} />
            <DateLine label="Approved" iso={order.approvedAt} />
            <DateLine label="Activated" iso={order.activatedAt} />
            <DateLine label="Paused" iso={order.pausedAt} />
            <DateLine label="Completed" iso={order.completedAt} />
            <DateLine label="Canceled" iso={order.canceledAt} />
            <DateLine label="Created" iso={order.createdAt} />
            <DateLine label="Updated" iso={order.updatedAt} />
          </ul>
        </SectionPanel>
      ) : null}
    </div>
  );
}
