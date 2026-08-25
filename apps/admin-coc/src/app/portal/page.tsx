import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ClientPortalShell } from "@/components/client-portal/client-portal-shell";
import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import {
  fetchClientFrontOfficeSummary,
  fetchClientPortalDashboard,
  isClientPortalApiConfigured,
} from "@/lib/client-portal-api/server";
import {
  isValidPortalAccessCode,
  portalLoginPath,
  portalPathAfterAccessGrant,
  portalSignedSessionCookieOptions,
} from "@/lib/client-portal/access-gate";
import { mapClientPortalDashboard } from "@/lib/client-portal/map-client-dashboard";
import {
  emptyPortalAccountSnapshot,
  mapClientFrontOfficeSummary,
} from "@/lib/client-portal/map-client-summary";
import { buildMockClientPortalDashboard } from "@/lib/client-portal/mock-data";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import {
  loadPortalPageContext,
  safePortalNextPath,
} from "@/lib/client-portal/portal-page-context";
import { parseClientPortalRange } from "@/lib/client-portal/range";

export const dynamic = "force-dynamic";

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rangeKey = parseClientPortalRange(firstString(sp.range));
  const nextPath = rangeKey === "7d" ? "/portal" : `/portal?range=${encodeURIComponent(rangeKey)}`;

  if (isClientPortalApiConfigured()) {
    const accessParam = firstString(sp.access);
    if (accessParam && isValidPortalAccessCode(accessParam)) {
      const signed = portalSignedSessionCookieOptions();
      if (signed) {
        const cookieStore = await cookies();
        cookieStore.set(signed);
        redirect(portalPathAfterAccessGrant(rangeKey));
      }
    }
  }

  const ctx = await loadPortalPageContext({ nextPath, rangeKey });
  if (ctx.mode === "login_required") {
    redirect(portalLoginPath(safePortalNextPath(ctx.nextPath, nextPath)));
  }
  if (ctx.mode === "access_gate") {
    return <PortalAccessGate rangeKey={ctx.rangeKey} />;
  }

  if (ctx.mode === "live") {
    const sessionDisplayName =
      ctx.session.portalDisplayName?.trim() || ctx.session.clientDisplayName?.trim();
    const displayOpts = sessionDisplayName ? { displayName: sessionDisplayName } : undefined;

    const [result, summary] = await Promise.all([
      fetchClientPortalDashboard({ range: rangeKey, clientAccountId: ctx.clientAccountId }),
      fetchClientFrontOfficeSummary({ clientAccountId: ctx.clientAccountId }),
    ]);
    const snapshot = summary.error
      ? emptyPortalAccountSnapshot()
      : mapClientFrontOfficeSummary(summary.data);

    if (result.ok) {
      const dashboard = mapClientPortalDashboard(result.data, displayOpts);
      return (
        <PortalAppFrame displayName={ctx.displayName} showSignOut>
          <ClientPortalShell dashboard={dashboard} snapshot={snapshot} />
        </PortalAppFrame>
      );
    }

    const previewCopy = resolvePortalPreviewBannerCopy("live_fetch_failed", {
      status: result.status,
      body: result.body,
    });
    return (
      <PortalAppFrame displayName={ctx.displayName} showSignOut previewCopy={previewCopy}>
        <ClientPortalShell dashboard={null} snapshot={snapshot} />
      </PortalAppFrame>
    );
  }

  const dashboard = mapClientPortalDashboard(buildMockClientPortalDashboard(rangeKey));
  const previewCopy = resolvePortalPreviewBannerCopy("not_configured");
  return (
    <PortalAppFrame displayName={ctx.displayName} previewCopy={previewCopy}>
      <ClientPortalShell dashboard={dashboard} snapshot={emptyPortalAccountSnapshot()} />
    </PortalAppFrame>
  );
}
