import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  completePublicOnboardingAction,
  savePortalAccountAction,
} from "@/app/actions/portal-account";
import { AgedVetSetupForm } from "@/components/public-site/aged-vet-setup-form";
import { PublicSiteShell } from "@/components/public-site/public-site-shell";
import { fetchClientAccountProfile } from "@/lib/client-portal-api/account";
import { isClientPortalApiConfigured } from "@/lib/client-portal-api/keys";
import type { PortalAccountProfile } from "@/lib/client-portal/account-profile";
import { readTrustedPortalSession } from "@/lib/client-portal/portal-auth";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";
import { PUBLIC_PLACE_ORDER_HREF } from "@/lib/client-portal/portal-register";
import { PUBLIC_REGISTER_PATH } from "@/lib/public-site/marketing-paths";

export const dynamic = "force-dynamic";

export default async function PublicSetupPage() {
  if (!isClientPortalApiConfigured()) {
    return (
      <PublicSiteShell>
        <main className="relative mx-auto max-w-lg px-4 py-16">
          <div className="avl-card rounded-3xl p-6 sm:p-8">
            <h1 className="text-2xl font-semibold text-white">Setup is not available</h1>
            <p className="mt-3 text-sm text-[#b7c7d6]">
              Account setup cannot run until the portal API is configured. Sign in again later.
            </p>
          </div>
        </main>
      </PublicSiteShell>
    );
  }

  const store = await cookies();
  const trusted = await readTrustedPortalSession(
    store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value
  );
  if (!trusted) redirect(PUBLIC_REGISTER_PATH);

  const profileResult = await fetchClientAccountProfile({
    clientAccountId: trusted.clientAccountId,
  });
  if (profileResult.account?.readyToOrder) {
    redirect(PUBLIC_PLACE_ORDER_HREF);
  }

  const fallbackAccount: PortalAccountProfile = {
    clientDisplayName: trusted.clientDisplayName,
    portalDisplayName: trusted.portalDisplayName,
    portalLoginEmail: trusted.portalLoginEmail,
    primaryNicheKeys: [],
    primaryProductTypes: [],
    status: "onboarding",
    profileComplete: false,
    readyToOrder: false,
    missingFields: ["primaryNicheKeys", "primaryProductTypes"],
  };

  return (
    <PublicSiteShell>
      <main className="relative mx-auto max-w-lg px-4 py-10 sm:px-6 sm:py-16">
        <AgedVetSetupForm
          initialAccount={profileResult.account ?? fallbackAccount}
          loginEmail={
            profileResult.account?.portalLoginEmail ?? trusted.portalLoginEmail ?? null
          }
          saveActionImpl={savePortalAccountAction}
          completeActionImpl={completePublicOnboardingAction}
        />
      </main>
    </PublicSiteShell>
  );
}
