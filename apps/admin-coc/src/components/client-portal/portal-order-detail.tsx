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

export function PortalOrderDetail({ order }: { order: PortalOrderDetailView }) {
  const orderedAt = formatPortalDate(order.submittedAt ?? order.createdAt);
  const volumeLabel = Number.isFinite(order.volume) ? order.volume.toLocaleString() : null;
  const nextStep = portalOrderNextStep(order);
  const fulfillmentBody = order.fulfillmentSummaryIsPlaceholder
    ? null
    : order.fulfillmentSummary;

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
              {order.orderNumber}
            </h1>
            {orderedAt ? (
              <p className="mt-1 text-sm text-slate-500">Ordered {orderedAt}</p>
            ) : null}
          </div>
          <PortalStatusPill
            label={portalOrderStatusLabel(order.status)}
            tone={portalOrderStatusTone(order.status)}
          />
        </div>
      </div>

      <SectionPanel title="Order summary">
        <dl className="grid gap-4 p-4 sm:grid-cols-2">
          <Fact label="Lead type" value={order.nicheLabel !== "—" ? order.nicheLabel : null} />
          <Fact label="Product" value={order.productLabel} />
          <Fact label="Requested quantity" value={volumeLabel} />
          <Fact label="Order type" value={order.campaignType !== "—" ? order.campaignType : null} />
          <Fact label="Delivery cadence" value={order.deliveryCadence} />
          <Fact label="CRM package" value={order.crmPackage} />
          <Fact label="Destination" value={order.destination !== "—" ? order.destination : null} />
          <Fact label="Destination type" value={order.destinationType} />
          <Fact label="AI voice add-on" value={order.aiVoiceAddon ? "Included" : null} />
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

      <SectionPanel title="Fulfillment">
        <div className="space-y-3 p-4">
          {fulfillmentBody ? (
            <p className="text-sm text-slate-700">{fulfillmentBody}</p>
          ) : (
            <p className="text-sm text-slate-600">
              Detailed fulfillment progress is not available yet.
            </p>
          )}
          {order.setupWarnings.length > 0 ? (
            <ul className="space-y-1">
              {order.setupWarnings.map((warning) => (
                <li key={warning} className="text-sm text-amber-800">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </SectionPanel>

      <SectionPanel title="Delivered leads">
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-600">
            Delivered leads are not linked to individual orders yet. You can review leads
            delivered to your account on the Leads page.
          </p>
          <Link
            href="/portal/leads"
            className="inline-flex min-h-10 items-center text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
          >
            View account leads
          </Link>
        </div>
      </SectionPanel>

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
