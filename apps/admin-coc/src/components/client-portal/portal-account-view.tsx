"use client";

import { useEffect, useState } from "react";

import {
  preferPortalAccountProfile,
  type PortalAccountFormAction,
  type PortalAccountProfile,
} from "@/lib/client-portal/account-profile";

import { PortalAccountOnboarding } from "./portal-account-onboarding";
import { PortalAccountPanel } from "./portal-account-panel";
import { PortalUnavailableState } from "./portal-unavailable-state";

export function PortalAccountView({
  initialAccount,
  loginEmail,
  accountUnavailable = false,
  readOnly = false,
  saveActionImpl,
  completeActionImpl,
}: {
  initialAccount: PortalAccountProfile;
  loginEmail?: string | null;
  accountUnavailable?: boolean;
  readOnly?: boolean;
  saveActionImpl: PortalAccountFormAction;
  completeActionImpl: PortalAccountFormAction;
}) {
  const [account, setAccount] = useState(initialAccount);

  useEffect(() => {
    setAccount((current) => preferPortalAccountProfile(current, initialAccount));
  }, [initialAccount]);

  const panelDisplayName = account.portalDisplayName?.trim() || account.clientDisplayName;

  if (accountUnavailable) {
    return (
      <PortalUnavailableState
        title="Account details could not be loaded"
        hint="Your sign-in is still valid. Account setup will appear once the account service responds."
      />
    );
  }

  return (
    <>
      <PortalAccountOnboarding
        initialAccount={account}
        readOnly={readOnly}
        saveActionImpl={saveActionImpl}
        completeActionImpl={completeActionImpl}
        onSuccess={setAccount}
      />
      <PortalAccountPanel
        displayName={panelDisplayName}
        loginEmail={account.portalLoginEmail ?? loginEmail}
        nicheLabels={account.primaryNicheKeys}
        productLabels={account.primaryProductTypes}
      />
    </>
  );
}
