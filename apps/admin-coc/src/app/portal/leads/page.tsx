import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalLeadsList } from "@/components/client-portal/portal-leads-list";
import { PortalLeadsStatusFilter } from "@/components/client-portal/portal-leads-status-filter";
import { PortalUnavailableState } from "@/components/client-portal/portal-unavailable-state";
import { fetchClientLeadDeliveryList } from "@/lib/client-portal-api/server";
import { portalLoginPath } from "@/lib/client-portal/access-gate";
import { mapClientLeadDeliveryRows } from "@/lib/client-portal/map-client-leads";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import {
  firstPortalSearchParam,
  parsePortalLeadListStatus,
  portalLeadListApiStatus,
  portalLeadListPath,
} from "@/lib/client-portal/portal-lead-list-status";
import { loadPortalPageContext } from "@/lib/client-portal/portal-page-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Leads",
  description: "Leads delivered to your account.",
};

export default async function PortalLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const statusFilter = parsePortalLeadListStatus(firstPortalSearchParam(sp.status));
  const nextPath = portalLeadListPath(statusFilter);

  const ctx = await loadPortalPageContext({ nextPath });
  if (ctx.mode === "login_required") redirect(portalLoginPath(ctx.nextPath));
  if (ctx.mode === "access_gate") return <PortalAccessGate rangeKey={ctx.rangeKey} />;

  if (ctx.mode === "mock") {
    return (
      <PortalAppFrame
        displayName={ctx.displayName}
        previewCopy={resolvePortalPreviewBannerCopy("not_configured")}
      >
        <div className="space-y-4" data-lead-list-status={statusFilter} key={statusFilter}>
          <LeadsPageHeader statusFilter={statusFilter} />
          <PortalUnavailableState
            title="Delivered leads are not connected yet"
            hint="This preview does not invent delivered-lead history. Live leads appear after the portal API is configured for your account."
          />
        </div>
      </PortalAppFrame>
    );
  }

  const result = await fetchClientLeadDeliveryList({
    clientAccountId: ctx.clientAccountId,
    status: portalLeadListApiStatus(statusFilter),
  });
  const leads = mapClientLeadDeliveryRows(result.items);
  const previewCopy = result.error
    ? resolvePortalPreviewBannerCopy("live_fetch_failed", { status: 502, body: result.error })
    : null;

  return (
    <PortalAppFrame displayName={ctx.displayName} showSignOut previewCopy={previewCopy}>
      <div className="space-y-4" data-lead-list-status={statusFilter} key={statusFilter}>
        <LeadsPageHeader statusFilter={statusFilter} />
        {result.error ? (
          <PortalUnavailableState
            title="Leads could not be loaded"
            hint="We could not load delivered leads. Try again shortly, or contact your SA360 team."
          />
        ) : (
          <PortalLeadsList leads={leads} statusFilter={statusFilter} />
        )}
      </div>
    </PortalAppFrame>
  );
}

function LeadsPageHeader({
  statusFilter,
}: {
  statusFilter: ReturnType<typeof parsePortalLeadListStatus>;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Leads</h1>
        <p className="mt-1 text-sm text-slate-500">
          Leads delivered to your account. Contact details stay masked.
        </p>
      </div>
      <PortalLeadsStatusFilter active={statusFilter} />
    </div>
  );
}
