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
  hasPortalAccessSession,
  isClientPortalAccessGateRequired,
  isValidPortalAccessCode,
  portalAccessCookieOptions,
  portalPathAfterAccessGrant,
  resolvePortalRenderMode,
} from "@/lib/client-portal/access-gate";
import { getClientPortalDisplayName, getClientPortalLocationLabel } from "@/lib/client-portal/config";
import { mapClientPortalDashboard } from "@/lib/client-portal/map-client-dashboard";
import { buildMockClientPortalDashboard } from "@/lib/client-portal/mock-data";
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
  const displayOpts = {
    displayName: getClientPortalDisplayName(),
    locationLabel: getClientPortalLocationLabel(),
  };

  const apiConfigured = isClientPortalApiConfigured();
  const gateRequired = isClientPortalAccessGateRequired();
  const cookieStore = await cookies();
  const accessParam = firstString(sp.access);

  if (gateRequired && accessParam && isValidPortalAccessCode(accessParam)) {
    cookieStore.set(portalAccessCookieOptions());
    redirect(portalPathAfterAccessGrant(rangeKey));
  }

  const hasAccess = hasPortalAccessSession(
    cookieStore.get(portalAccessCookieOptions().name)?.value
  );

  const mode = resolvePortalRenderMode({
    apiConfigured,
    gateRequired,
    hasAccess,
  });

  if (mode === "access_gate") {
    return <PortalAccessGate rangeKey={rangeKey} />;
  }

  if (mode === "live") {
    const result = await fetchClientPortalDashboard({ range: rangeKey });
    if (result.ok) {
      const dashboard = mapClientPortalDashboard(result.data, displayOpts);
      return <ClientPortalShell dashboard={dashboard} previewMode={false} />;
    }

    const mock = mapClientPortalDashboard(buildMockClientPortalDashboard(rangeKey), displayOpts);
    return (
      <>
        <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
          <WarningBanner tone="warn" title="Live dashboard unavailable">
            {`Could not load metrics (${result.status || "error"}). Showing preview data.`}
          </WarningBanner>
        </div>
        <ClientPortalShell dashboard={mock} previewMode />
      </>
    );
  }

  const dashboard = mapClientPortalDashboard(
    buildMockClientPortalDashboard(rangeKey),
    displayOpts
  );
  return <ClientPortalShell dashboard={dashboard} previewMode />;
}
