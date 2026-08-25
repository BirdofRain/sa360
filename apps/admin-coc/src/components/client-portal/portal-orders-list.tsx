import Link from "next/link";
import { Package } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import {
  formatPortalDate,
  portalOrderStatusLabel,
  portalOrderStatusTone,
  type PortalOrderView,
} from "@/lib/client-portal/map-client-orders";

import { PortalStatusPill } from "./portal-status-pill";

function OrderCard({ order }: { order: PortalOrderView }) {
  const href = `/portal/orders/${encodeURIComponent(order.id)}`;
  const date = formatPortalDate(order.createdAt);
  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] md:hidden">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-medium text-slate-900">{order.orderNumber}</h2>
          {order.campaignType !== "—" ? (
            <p className="text-xs text-slate-500">{order.campaignType}</p>
          ) : null}
        </div>
        <PortalStatusPill
          label={portalOrderStatusLabel(order.status)}
          tone={portalOrderStatusTone(order.status)}
        />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {order.nicheLabel !== "—" ? (
          <div>
            <dt className="text-xs text-slate-500">Focus</dt>
            <dd className="text-slate-800">{order.nicheLabel}</dd>
          </div>
        ) : null}
        {order.statesLabel !== "—" ? (
          <div>
            <dt className="text-xs text-slate-500">States</dt>
            <dd className="text-slate-800">{order.statesLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-slate-500">Quantity</dt>
          <dd className="text-slate-800">{order.volume.toLocaleString()}</dd>
        </div>
        {date ? (
          <div>
            <dt className="text-xs text-slate-500">Ordered</dt>
            <dd className="text-slate-800">{date}</dd>
          </div>
        ) : null}
      </dl>
      <Link
        href={href}
        className="inline-flex min-h-10 items-center text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
      >
        View order
      </Link>
    </article>
  );
}

export function PortalOrdersList({ orders }: { orders: PortalOrderView[] }) {
  if (orders.length === 0) {
    return (
      <SectionPanel title="Orders">
        <EmptyState
          icon={Package}
          title="No orders yet"
          hint="When your SA360 team opens a lead order for this account, it will appear here."
        />
      </SectionPanel>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 md:hidden">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </div>

      <SectionPanel title="Orders" className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Focus</th>
                <th className="px-4 py-2 font-medium">States</th>
                <th className="px-4 py-2 font-medium text-right">Volume</th>
                <th className="px-4 py-2 font-medium">Updated</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-slate-800">{order.orderNumber}</div>
                    {order.campaignType !== "—" ? (
                      <div className="text-xs text-slate-500">{order.campaignType}</div>
                    ) : null}
                    {order.setupWarnings.length > 0 ? (
                      <p className="mt-1 text-xs text-amber-700">{order.setupWarnings[0]}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <PortalStatusPill
                      label={portalOrderStatusLabel(order.status)}
                      tone={portalOrderStatusTone(order.status)}
                    />
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">
                    <div>{order.nicheLabel}</div>
                    {order.productLabel ? (
                      <div className="text-xs text-slate-500">{order.productLabel}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">{order.statesLabel}</td>
                  <td className="px-4 py-3 align-top text-right text-slate-700">
                    {order.volume.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-500">
                    {order.createdAt ? formatRelativeTime(order.createdAt) : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/portal/orders/${encodeURIComponent(order.id)}`}
                      className="text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
                    >
                      View order
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionPanel>
    </div>
  );
}
