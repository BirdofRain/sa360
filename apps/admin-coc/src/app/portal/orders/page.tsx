import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalOrdersList } from "@/components/client-portal/portal-orders-list";
import { PortalUnavailableState } from "@/components/client-portal/portal-unavailable-state";
import { fetchClientLeadOrdersList } from "@/lib/client-portal-api/server";
import { mapClientLeadOrderRows } from "@/lib/client-portal/map-client-orders";
import { portalLoginPath } from "@/lib/client-portal/access-gate";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import { loadPortalPageContext } from "@/lib/client-portal/portal-page-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Orders",
  description: "Lead order status for your account.",
};

export default async function PortalOrdersPage() {
  const ctx = await loadPortalPageContext({ nextPath: "/portal/orders" });
  if (ctx.mode === "login_required") redirect(portalLoginPath(ctx.nextPath));
  if (ctx.mode === "access_gate") return <PortalAccessGate rangeKey={ctx.rangeKey} />;

  if (ctx.mode === "mock") {
    return (
      <PortalAppFrame
        displayName={ctx.displayName}
        previewCopy={resolvePortalPreviewBannerCopy("not_configured")}
      >
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Orders</h1>
          <PortalUnavailableState
            title="Orders are not connected yet"
            hint="This preview does not invent order history. Live order status appears after the portal API is configured for your account."
          />
        </div>
      </PortalAppFrame>
    );
  }

  const result = await fetchClientLeadOrdersList({ clientAccountId: ctx.clientAccountId });
  const orders = mapClientLeadOrderRows(result.items);
  const previewCopy = result.error
    ? resolvePortalPreviewBannerCopy("live_fetch_failed", { status: 502, body: result.error })
    : null;

  return (
    <PortalAppFrame displayName={ctx.displayName} showSignOut previewCopy={previewCopy}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            Lead orders for your account, including setup and fulfillment status.
          </p>
        </div>
        {result.error ? (
          <PortalUnavailableState
            title="Orders could not be loaded"
            hint="We could not load your order list. Try again shortly, or contact your SA360 team."
          />
        ) : (
          <PortalOrdersList orders={orders} />
        )}
      </div>
    </PortalAppFrame>
  );
}
