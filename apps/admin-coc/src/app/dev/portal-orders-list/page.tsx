import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalOrdersList } from "@/components/client-portal/portal-orders-list";
import { portalOrdersListPreviewOrders } from "@/lib/client-portal/portal-order-fulfillment-fixtures";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Orders list preview",
  description: "Local fixtures for customer portal order list.",
};

export default function PortalOrdersListPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <PortalAppFrame displayName="Valley Vet">
      <div className="space-y-4">
        <p className="rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2 text-xs text-sky-800">
          Local order-list fixtures — not live account data.
        </p>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            Lead orders for your account, including payment and delivery status.
          </p>
        </div>
        <PortalOrdersList
          orders={portalOrdersListPreviewOrders()}
          displayName="Valley Vet"
          placeOrderHref="/portal/orders/new"
        />
      </div>
    </PortalAppFrame>
  );
}
