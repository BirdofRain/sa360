import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalLeadDetail } from "@/components/client-portal/portal-lead-detail";
import { PortalUnavailableState } from "@/components/client-portal/portal-unavailable-state";
import { fetchClientLeadDeliveryDetail } from "@/lib/client-portal-api/server";
import { portalLoginPath } from "@/lib/client-portal/access-gate";
import { mapClientLeadDeliveryDetail } from "@/lib/client-portal/map-client-leads";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import {
  isPortalLeadNotFoundStatus,
  parsePortalLeadId,
  portalLeadDetailPath,
} from "@/lib/client-portal/portal-lead-detail";
import {
  firstPortalSearchParam,
  parsePortalLeadListStatus,
  portalLeadListPath,
  type PortalLeadListStatus,
} from "@/lib/client-portal/portal-lead-list-status";
import { loadPortalPageContext } from "@/lib/client-portal/portal-page-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lead",
  description: "Lead details for your account.",
};

export default async function PortalLeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ leadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { leadId: rawId } = await params;
  const sp = await searchParams;
  const listStatus = parsePortalLeadListStatus(firstPortalSearchParam(sp.status));
  const leadId = parsePortalLeadId(rawId);
  const nextPath = leadId ? portalLeadDetailPath(leadId, listStatus) : portalLeadListPath(listStatus);

  const ctx = await loadPortalPageContext({ nextPath });
  if (ctx.mode === "login_required") redirect(portalLoginPath(ctx.nextPath));
  if (ctx.mode === "access_gate") return <PortalAccessGate rangeKey={ctx.rangeKey} />;

  if (!leadId) {
    return (
      <PortalAppFrame displayName={ctx.displayName} showSignOut={ctx.mode === "live"}>
        <LeadNotFound listStatus={listStatus} />
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
            href={portalLeadListPath(listStatus)}
            className="inline-flex min-h-10 items-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
          >
            Back to Leads
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Lead</h1>
          <PortalUnavailableState
            title="Lead details are not connected yet"
            hint="This preview does not invent delivered-lead history. Live lead details appear after the portal API is configured for your account."
          />
        </div>
      </PortalAppFrame>
    );
  }

  const result = await fetchClientLeadDeliveryDetail({
    clientAccountId: ctx.clientAccountId,
    id: leadId,
  });

  if (result.error && isPortalLeadNotFoundStatus(result.status)) {
    return (
      <PortalAppFrame displayName={ctx.displayName} showSignOut>
        <LeadNotFound listStatus={listStatus} />
      </PortalAppFrame>
    );
  }

  if (result.error || !result.item) {
    const previewCopy = resolvePortalPreviewBannerCopy("live_fetch_failed", {
      status: result.status || 502,
      body: result.error ?? "Lead could not be loaded",
    });
    return (
      <PortalAppFrame displayName={ctx.displayName} showSignOut previewCopy={previewCopy}>
        <div className="space-y-4">
          <Link
            href={portalLeadListPath(listStatus)}
            className="inline-flex min-h-10 items-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
          >
            Back to Leads
          </Link>
          <PortalUnavailableState
            title="Lead could not be loaded"
            hint="We could not load this lead. Try again shortly, or contact your SA360 team."
          />
        </div>
      </PortalAppFrame>
    );
  }

  const lead = mapClientLeadDeliveryDetail(result.item);
  if (!lead) {
    return (
      <PortalAppFrame displayName={ctx.displayName} showSignOut>
        <LeadNotFound listStatus={listStatus} />
      </PortalAppFrame>
    );
  }

  return (
    <PortalAppFrame displayName={ctx.displayName} showSignOut>
      <PortalLeadDetail lead={lead} listStatus={listStatus} />
    </PortalAppFrame>
  );
}

function LeadNotFound({ listStatus }: { listStatus: PortalLeadListStatus }) {
  return (
    <div className="space-y-4">
      <Link
        href={portalLeadListPath(listStatus)}
        className="inline-flex min-h-10 items-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
      >
        Back to Leads
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Lead</h1>
      <PortalUnavailableState
        title="Lead not found"
        hint="This lead is not available on your account. It may have been removed, or the link may be incorrect."
      />
    </div>
  );
}
