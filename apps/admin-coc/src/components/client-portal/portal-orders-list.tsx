import { Package } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import {
  portalOrderStatusLabel,
  portalOrderStatusTone,
  type PortalOrderView,
} from "@/lib/client-portal/map-client-orders";

import { PortalStatusPill } from "./portal-status-pill";

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
    <SectionPanel title="Orders">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-slate-800">{order.orderNumber}</div>
                  <div className="text-xs text-slate-500">{order.campaignType}</div>
                  {order.fulfillmentSummary ? (
                    <div className="mt-1 text-xs text-slate-500">{order.fulfillmentSummary}</div>
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
                  {order.createdAt ? formatRelativeTime(order.createdAt) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionPanel>
  );
}
