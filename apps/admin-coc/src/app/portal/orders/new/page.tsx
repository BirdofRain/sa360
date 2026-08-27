import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalOrderRequestForm } from "@/components/client-portal/portal-order-request-form";
import { PortalUnavailableState } from "@/components/client-portal/portal-unavailable-state";
import { fetchPortalClientContext } from "@/lib/client-portal-api/server";
import { portalLoginPath } from "@/lib/client-portal/access-gate";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import {
  buildPortalOrderRequestCatalogs,
  mapPortalOrderRequestContext,
} from "@/lib/client-portal/portal-order-request";
import { loadPortalPageContext } from "@/lib/client-portal/portal-page-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Place order",
  description: "Submit a lead order request for your account.",
};

export default async function PortalNewOrderPage() {
  const ctx = await loadPortalPageContext({ nextPath: "/portal/orders/new" });
  if (ctx.mode === "login_required") redirect(portalLoginPath(ctx.nextPath));
  if (ctx.mode === "access_gate") return <PortalAccessGate rangeKey={ctx.rangeKey} />;

  if (ctx.mode === "mock") {
    const catalogs = buildPortalOrderRequestCatalogs({
      displayName: ctx.displayName,
    });
    return (
      <PortalAppFrame
        displayName={ctx.displayName}
        previewCopy={resolvePortalPreviewBannerCopy("not_configured")}
      >
        <NewOrderHeader />
        <PortalOrderRequestForm eligible catalogs={catalogs} />
      </PortalAppFrame>
    );
  }

  const contextResult = ctx.session.portalLoginEmail
    ? await fetchPortalClientContext(ctx.session.portalLoginEmail)
    : { ok: false as const, status: 0, body: "Portal login email is missing" };

  if (!contextResult.ok) {
    const previewCopy = resolvePortalPreviewBannerCopy("live_fetch_failed", {
      status: contextResult.status || 502,
      body: contextResult.body,
    });
    return (
      <PortalAppFrame displayName={ctx.displayName} showSignOut previewCopy={previewCopy}>
        <NewOrderHeader />
        <PortalUnavailableState
          title="Account details could not be loaded"
          hint="We could not load the options needed to place an order request. Try again shortly, or open your account page."
        />
      </PortalAppFrame>
    );
  }

  const requestContext = mapPortalOrderRequestContext(contextResult.data, ctx.displayName);

  return (
    <PortalAppFrame displayName={ctx.displayName} showSignOut>
      <NewOrderHeader />
      <PortalOrderRequestForm
        eligible={requestContext.eligible}
        catalogs={requestContext.catalogs}
      />
    </PortalAppFrame>
  );
}

function NewOrderHeader() {
  return (
    <div className="min-w-0 space-y-3">
      <Link
        href="/portal/orders"
        className="inline-flex min-h-10 items-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
      >
        Back to orders
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Place order</h1>
        <p className="mt-1 text-sm text-slate-500">
          Submit an order request. Your SA360 team will confirm payment and approve it before
          fulfillment begins.
        </p>
      </div>
    </div>
  );
}
