import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  completePortalAccountAction,
  savePortalAccountAction,
} from "@/app/actions/portal-account";
import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAccountView } from "@/components/client-portal/portal-account-view";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { fetchClientAccountProfile } from "@/lib/client-portal-api/account";
import { portalLoginPath } from "@/lib/client-portal/access-gate";
import type { PortalAccountProfile } from "@/lib/client-portal/account-profile";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import { loadPortalPageContext } from "@/lib/client-portal/portal-page-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account",
  description: "Complete your account details and review your profile.",
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
          <p className="mt-1 text-sm text-slate-500">
            Your profile, lead focus, and what to do next.
          </p>
          <PortalAccountView
            initialAccount={{ ...MOCK_ACCOUNT, clientDisplayName: ctx.displayName }}
            readOnly
            saveActionImpl={savePortalAccountAction}
            completeActionImpl={completePortalAccountAction}
          />
        </div>
      </PortalAppFrame>
    );
  }

  const profileResult = await fetchClientAccountProfile({
    clientAccountId: ctx.clientAccountId,
  });
  const previewCopy = profileResult.error
    ? resolvePortalPreviewBannerCopy("live_fetch_failed", {
        status: 502,
        body: profileResult.error,
      })
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
            Your profile, lead focus, and what to do next.
          </p>
        </div>
        <PortalAccountView
          initialAccount={account}
          loginEmail={account.portalLoginEmail ?? ctx.session.portalLoginEmail}
          accountUnavailable={Boolean(profileResult.error && !profileResult.account)}
          saveActionImpl={savePortalAccountAction}
          completeActionImpl={completePortalAccountAction}
        />
      </div>
    </PortalAppFrame>
  );
}
