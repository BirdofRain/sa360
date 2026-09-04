import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  completePortalAccountAction,
  refreshPortalAccountTrustAction,
  savePortalAccountAction,
} from "@/app/actions/portal-account";
import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAccountView } from "@/components/client-portal/portal-account-view";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { fetchClientAccountProfile } from "@/lib/client-portal-api/account";
import { fetchClientTrustCenter } from "@/lib/client-portal-api/server";
import { getClientPortalLocationLabel } from "@/lib/client-portal/config";
import { portalLoginPath } from "@/lib/client-portal/access-gate";
import { mapClientTrustCenter } from "@/lib/client-portal/map-client-trust";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import { loadPortalPageContext } from "@/lib/client-portal/portal-page-context";
import type { PortalAccountProfile } from "@/lib/client-portal/account-profile";

export const dynamic = "force-dynamic";

// No route-level loading.tsx: Finish account setup must keep the completed UI
// visible instead of swapping in a full-page skeleton during post-mutation refresh.

export const metadata: Metadata = {
  title: "Account",
  description: "Complete your account details and review connection status.",
};

const MOCK_ACCOUNT: PortalAccountProfile = {
  clientDisplayName: "Your business",
  portalDisplayName: null,
  portalLoginEmail: null,
  primaryNicheKeys: [],
  primaryProductTypes: [],
  status: "onboarding",
  profileComplete: false,
  readyToOrder: false,
  missingFields: ["primaryNicheKeys", "primaryProductTypes"],
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
          <PortalAccountView
            initialAccount={{ ...MOCK_ACCOUNT, clientDisplayName: ctx.displayName }}
            locationLabel={getClientPortalLocationLabel()}
            initialTrust={null}
            readOnly
            saveActionImpl={savePortalAccountAction}
            completeActionImpl={completePortalAccountAction}
            refreshTrustImpl={refreshPortalAccountTrustAction}
          />
        </div>
      </PortalAppFrame>
    );
  }

  const [profileResult, trustResult] = await Promise.all([
    fetchClientAccountProfile({ clientAccountId: ctx.clientAccountId }),
    fetchClientTrustCenter({ clientAccountId: ctx.clientAccountId }),
  ]);
  const trust = trustResult.error ? null : mapClientTrustCenter(trustResult.data);
  const previewCopy = profileResult.error
    ? resolvePortalPreviewBannerCopy("live_fetch_failed", { status: 502, body: profileResult.error })
    : trustResult.error
      ? resolvePortalPreviewBannerCopy("live_fetch_failed", { status: 502, body: trustResult.error })
      : null;
  const fallbackAccount: PortalAccountProfile = {
    clientDisplayName: ctx.displayName,
    portalDisplayName: ctx.session.portalDisplayName,
    portalLoginEmail: ctx.session.portalLoginEmail,
    primaryNicheKeys: [],
    primaryProductTypes: [],
    status: "onboarding",
    profileComplete: false,
    readyToOrder: false,
    missingFields: ["primaryNicheKeys", "primaryProductTypes"],
  };
  const account = profileResult.account ?? fallbackAccount;

  return (
    <PortalAppFrame displayName={ctx.displayName} showSignOut previewCopy={previewCopy}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Account</h1>
          <p className="mt-1 text-sm text-slate-500">
            Required account details and the connection status we can confirm today.
          </p>
        </div>
        <PortalAccountView
          initialAccount={account}
          loginEmail={account.portalLoginEmail ?? ctx.session.portalLoginEmail}
          initialTrust={trust}
          accountUnavailable={Boolean(profileResult.error && !profileResult.account)}
          trustUnavailable={Boolean(trustResult.error)}
          saveActionImpl={savePortalAccountAction}
          completeActionImpl={completePortalAccountAction}
          refreshTrustImpl={refreshPortalAccountTrustAction}
        />
      </div>
    </PortalAppFrame>
  );
}
