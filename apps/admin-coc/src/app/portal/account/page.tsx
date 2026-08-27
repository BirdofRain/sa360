import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  completePortalAccountAction,
  savePortalAccountAction,
} from "@/app/actions/portal-account";
import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAccountOnboarding } from "@/components/client-portal/portal-account-onboarding";
import { PortalAccountPanel } from "@/components/client-portal/portal-account-panel";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalUnavailableState } from "@/components/client-portal/portal-unavailable-state";
import { fetchClientAccountProfile } from "@/lib/client-portal-api/account";
import { fetchClientTrustCenter } from "@/lib/client-portal-api/server";
import { getClientPortalLocationLabel } from "@/lib/client-portal/config";
import { portalLoginPath } from "@/lib/client-portal/access-gate";
import { mapClientTrustCenter } from "@/lib/client-portal/map-client-trust";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import { loadPortalPageContext } from "@/lib/client-portal/portal-page-context";
import type { PortalAccountProfile } from "@/lib/client-portal/account-profile";

export const dynamic = "force-dynamic";

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
          <PortalAccountOnboarding
            initialAccount={{ ...MOCK_ACCOUNT, clientDisplayName: ctx.displayName }}
            saveActionImpl={savePortalAccountAction}
            completeActionImpl={completePortalAccountAction}
            readOnly
          />
          <PortalAccountPanel
            displayName={ctx.displayName}
            locationLabel={getClientPortalLocationLabel()}
            trust={null}
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
        {profileResult.error && !profileResult.account ? (
          <PortalUnavailableState
            title="Account details could not be loaded"
            hint="Your sign-in is still valid. Account setup will appear once the account service responds."
          />
        ) : (
          <PortalAccountOnboarding
            initialAccount={account}
            saveActionImpl={savePortalAccountAction}
            completeActionImpl={completePortalAccountAction}
          />
        )}
        {trustResult.error ? (
          <PortalUnavailableState
            title="Account status could not be loaded"
            hint="Your sign-in is still valid. Status checks will appear once the account service responds."
          />
        ) : (
          <PortalAccountPanel
            displayName={account.portalDisplayName?.trim() || account.clientDisplayName}
            loginEmail={account.portalLoginEmail ?? ctx.session.portalLoginEmail}
            nicheLabels={account.primaryNicheKeys}
            productLabels={account.primaryProductTypes}
            trust={trust}
          />
        )}
      </div>
    </PortalAppFrame>
  );
}
