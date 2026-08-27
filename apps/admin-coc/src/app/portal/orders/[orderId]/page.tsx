import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalOrderDetail } from "@/components/client-portal/portal-order-detail";
import { PortalUnavailableState } from "@/components/client-portal/portal-unavailable-state";
import {
  fetchClientLeadOrderDetail,
  fetchClientLeadOrderLeads,
} from "@/lib/client-portal-api/server";
import { portalLoginPath } from "@/lib/client-portal/access-gate";
import { mapClientLeadOrderDetail } from "@/lib/client-portal/map-client-orders";
import { portalOrderLinkedLeadsState } from "@/lib/client-portal/portal-order-linked-leads-state";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import {
  isPortalOrderNotFoundStatus,
  parsePortalOrderId,
} from "@/lib/client-portal/portal-order-detail";
import { loadPortalPageContext } from "@/lib/client-portal/portal-page-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order",
  description: "Lead order details for your account.",
};

export default async function PortalOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId: rawId } = await params;
  const orderId = parsePortalOrderId(rawId);
  const nextPath = orderId ? `/portal/orders/${encodeURIComponent(orderId)}` : "/portal/orders";

  const ctx = await loadPortalPageContext({ nextPath });
  if (ctx.mode === "login_required") redirect(portalLoginPath(ctx.nextPath));
  if (ctx.mode === "access_gate") return <PortalAccessGate rangeKey={ctx.rangeKey} />;

  if (!orderId) {
    return (
      <PortalAppFrame displayName={ctx.displayName} showSignOut={ctx.mode === "live"}>
        <OrderNotFound />
      </PortalAppFrame>
    );
  }

  if (ctx.mode === "mock") {
    return (
      <PortalAppFrame
        displayName={ctx.displayName}
        previewCopy={resolvePortalPreviewBannerCopy("not_configured")}
      >
        <div className="space-y-4">
          <Link
            href="/portal/orders"
            className="inline-flex min-h-10 items-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
          >
            Back to Orders
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Order</h1>
          <PortalUnavailableState
            title="Order details are not connected yet"
            hint="This preview does not invent order history. Live order details appear after the portal API is configured for your account."
          />
        </div>
      </PortalAppFrame>
    );
  }

  const [result, leadsResult] = await Promise.all([
    fetchClientLeadOrderDetail({
      clientAccountId: ctx.clientAccountId,
      id: orderId,
    }),
    fetchClientLeadOrderLeads({
      clientAccountId: ctx.clientAccountId,
      id: orderId,
    }),
  ]);

  if (result.error && isPortalOrderNotFoundStatus(result.status)) {
    return (
      <PortalAppFrame displayName={ctx.displayName} showSignOut>
        <OrderNotFound />
      </PortalAppFrame>
    );
  }

  if (result.error || !result.item) {
    const previewCopy = resolvePortalPreviewBannerCopy("live_fetch_failed", {
      status: result.status || 502,
      body: result.error ?? "Order could not be loaded",
    });
    return (
      <PortalAppFrame displayName={ctx.displayName} showSignOut previewCopy={previewCopy}>
        <div className="space-y-4">
          <Link
            href="/portal/orders"
            className="inline-flex min-h-10 items-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
          >
            Back to Orders
          </Link>
          <PortalUnavailableState
            title="Order could not be loaded"
            hint="We could not load this order. Try again shortly, or contact your SA360 team."
          />
        </div>
      </PortalAppFrame>
    );
  }

  const order = mapClientLeadOrderDetail(result.item);
  if (!order) {
    return (
      <PortalAppFrame displayName={ctx.displayName} showSignOut>
        <OrderNotFound />
      </PortalAppFrame>
    );
  }

  const linked = portalOrderLinkedLeadsState(leadsResult);

  return (
    <PortalAppFrame displayName={ctx.displayName} showSignOut>
      <PortalOrderDetail
        order={order}
        displayName={ctx.displayName}
        linkedLeads={linked.leads}
        linkedLeadsError={linked.error}
        linkedLeadsHasMore={linked.hasMore}
      />
    </PortalAppFrame>
  );
}

function OrderNotFound() {
  return (
    <div className="space-y-4">
      <Link
        href="/portal/orders"
        className="inline-flex min-h-10 items-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
      >
        Back to Orders
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Order</h1>
      <PortalUnavailableState
        title="Order not found"
        hint="This order is not available on your account. It may have been removed, or the link may be incorrect."
      />
    </div>
  );
}
