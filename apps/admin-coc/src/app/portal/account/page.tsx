import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAccountPanel } from "@/components/client-portal/portal-account-panel";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalUnavailableState } from "@/components/client-portal/portal-unavailable-state";
import { fetchClientTrustCenter } from "@/lib/client-portal-api/server";
import { getClientPortalLocationLabel } from "@/lib/client-portal/config";
import { portalLoginPath } from "@/lib/client-portal/access-gate";
import { mapClientTrustCenter } from "@/lib/client-portal/map-client-trust";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import { loadPortalPageContext } from "@/lib/client-portal/portal-page-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account",
  description: "Your portal account and connection status.",
};

export default async function PortalAccountPage() {
  const ctx = await loadPortalPageContext({ nextPath: "/portal/account" });
  if (ctx.mode === "login_required") redirect(portalLoginPath(ctx.nextPath));
  if (ctx.mode === "access_gate") return <PortalAccessGate rangeKey={ctx.rangeKey} />;

  if (ctx.mode === "mock") {
    return (
      <PortalAppFrame
        displayName={ctx.displayName}
        previewCopy={resolvePortalPreviewBannerCopy("not_configured")}
      >
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Account</h1>
          <PortalAccountPanel
            displayName={ctx.displayName}
            locationLabel={getClientPortalLocationLabel()}
            trust={null}
          />
        </div>
      </PortalAppFrame>
    );
  }

  const result = await fetchClientTrustCenter({ clientAccountId: ctx.clientAccountId });
  const trust = result.error ? null : mapClientTrustCenter(result.data);
  const previewCopy = result.error
    ? resolvePortalPreviewBannerCopy("live_fetch_failed", { status: 502, body: result.error })
    : null;

  return (
    <PortalAppFrame displayName={ctx.displayName} showSignOut previewCopy={previewCopy}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Account</h1>
          <p className="mt-1 text-sm text-slate-500">
            Signed-in account details and connection status we can confirm today.
          </p>
        </div>
        {result.error ? (
          <PortalUnavailableState
            title="Account status could not be loaded"
            hint="Your sign-in is still valid. Status checks will appear once the account service responds."
          />
        ) : (
          <PortalAccountPanel
            displayName={ctx.displayName}
            loginEmail={ctx.session.portalLoginEmail}
            trust={trust}
          />
        )}
      </div>
    </PortalAppFrame>
  );
}
