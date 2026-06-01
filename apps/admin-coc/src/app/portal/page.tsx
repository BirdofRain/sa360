import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ClientPortalShell } from "@/components/client-portal/client-portal-shell";
import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import {
  fetchClientPortalDashboard,
  isClientPortalApiConfigured,
} from "@/lib/client-portal-api/server";
import {
  getPortalSession,
  hasPortalSession,
  isClientPortalAccessGateRequired,
  isValidPortalAccessCode,
  portalLoginPath,
  portalPathAfterAccessGrant,
  portalSignedSessionCookieOptions,
  resolvePortalRenderMode,
} from "@/lib/client-portal/access-gate";
import { isClientPortalLoginConfigured } from "@/lib/client-portal/portal-auth";
import { mapClientPortalDashboard } from "@/lib/client-portal/map-client-dashboard";
import { buildMockClientPortalDashboard } from "@/lib/client-portal/mock-data";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import { parseClientPortalRange } from "@/lib/client-portal/range";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

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

  const apiConfigured = isClientPortalApiConfigured();
  const gateRequired = isClientPortalAccessGateRequired();
  const loginConfigured = isClientPortalLoginConfigured();
  const cookieStore = await cookies();
  const accessParam = firstString(sp.access);

  /** Temporary invite link — grants signed session (see README). */
  if (accessParam && isValidPortalAccessCode(accessParam)) {
    const signed = portalSignedSessionCookieOptions();
    if (signed) {
      cookieStore.set(signed);
      redirect(portalPathAfterAccessGrant(rangeKey));
    }
  }

  const sessionCookie = cookieStore.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const hasSession = hasPortalSession(sessionCookie);

  const mode = resolvePortalRenderMode({
    apiConfigured,
    hasSession,
    loginConfigured,
    gateRequired,
  });

  if (mode === "login_required") {
    const next = rangeKey === "7d" ? "/portal" : `/portal?range=${encodeURIComponent(rangeKey)}`;
    redirect(portalLoginPath(next));
  }

  if (mode === "access_gate") {
    return <PortalAccessGate rangeKey={rangeKey} />;
  }

  if (mode === "live") {
    const session = getPortalSession(sessionCookie);
    const clientAccountId = session?.clientAccountId;
    if (!clientAccountId) {
      redirect(portalLoginPath(rangeKey === "7d" ? "/portal" : `/portal?range=${encodeURIComponent(rangeKey)}`));
    }

    const sessionDisplayName =
      session?.portalDisplayName?.trim() || session?.clientDisplayName?.trim();
    const displayOpts = sessionDisplayName
      ? { displayName: sessionDisplayName }
      : undefined;

    const result = await fetchClientPortalDashboard({ range: rangeKey, clientAccountId });
    if (result.ok) {
      const dashboard = mapClientPortalDashboard(result.data, displayOpts);
      return <ClientPortalShell dashboard={dashboard} previewMode={false} showSignOut />;
    }

    const mock = mapClientPortalDashboard(buildMockClientPortalDashboard(rangeKey), displayOpts);
    const previewCopy = resolvePortalPreviewBannerCopy("live_fetch_failed", {
      status: result.status,
      body: result.body,
    });
    return (
      <>
        {previewCopy.warningTitle && previewCopy.warningDetail ? (
          <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
            <WarningBanner tone="warn" title={previewCopy.warningTitle}>
              {previewCopy.warningDetail}
            </WarningBanner>
          </div>
        ) : null}
        <ClientPortalShell dashboard={mock} previewCopy={previewCopy} showSignOut />
      </>
    );
  }

  const dashboard = mapClientPortalDashboard(buildMockClientPortalDashboard(rangeKey));
  const previewCopy = resolvePortalPreviewBannerCopy("not_configured");
  return <ClientPortalShell dashboard={dashboard} previewCopy={previewCopy} />;
}
