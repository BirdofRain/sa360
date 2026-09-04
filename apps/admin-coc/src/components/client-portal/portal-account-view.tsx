"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  isPortalAccountSetupComplete,
  preferPortalAccountProfile,
  type PortalAccountFormAction,
  type PortalAccountProfile,
  type PortalAccountTrustRefreshState,
} from "@/lib/client-portal/account-profile";
import type { PortalTrustView } from "@/lib/client-portal/map-client-trust";

import { PortalAccountOnboarding } from "./portal-account-onboarding";
import { PortalAccountPanel } from "./portal-account-panel";
import { PortalUnavailableState } from "./portal-unavailable-state";

export function PortalAccountView({
  initialAccount,
  loginEmail,
  locationLabel,
  initialTrust,
  accountUnavailable = false,
  trustUnavailable = false,
  readOnly = false,
  saveActionImpl,
  completeActionImpl,
  refreshTrustImpl,
}: {
  initialAccount: PortalAccountProfile;
  loginEmail?: string | null;
  locationLabel?: string | null;
  initialTrust: PortalTrustView | null;
  accountUnavailable?: boolean;
  trustUnavailable?: boolean;
  readOnly?: boolean;
  saveActionImpl: PortalAccountFormAction;
  completeActionImpl: PortalAccountFormAction;
  refreshTrustImpl: () => Promise<PortalAccountTrustRefreshState>;
}) {
  const [account, setAccount] = useState(initialAccount);
  const [trust, setTrust] = useState(initialTrust);
  const [trustFailed, setTrustFailed] = useState(trustUnavailable);
  const trustRefreshStarted = useRef(false);
  const localTrustFresh = useRef(false);
  const trustRef = useRef(trust);
  trustRef.current = trust;
  const refreshTrustImplRef = useRef(refreshTrustImpl);
  refreshTrustImplRef.current = refreshTrustImpl;

  useEffect(() => {
    setAccount((current) => preferPortalAccountProfile(current, initialAccount));
  }, [initialAccount]);

  useEffect(() => {
    if (!trustUnavailable && initialTrust) {
      setTrust(initialTrust);
      setTrustFailed(false);
      return;
    }
    if (trustUnavailable && !localTrustFresh.current) {
      setTrustFailed(true);
    }
  }, [initialTrust, trustUnavailable]);

  const handleSuccess = useCallback((next: PortalAccountProfile) => {
    setAccount(next);
    if (!isPortalAccountSetupComplete(next) || trustRefreshStarted.current || readOnly) {
      return;
    }
    trustRefreshStarted.current = true;
    void refreshTrustImplRef.current().then((result) => {
      if (result.error) {
        if (!localTrustFresh.current && !trustRef.current) {
          setTrustFailed(true);
        }
        return;
      }
      localTrustFresh.current = true;
      setTrustFailed(false);
      setTrust(result.trust);
    });
  }, [readOnly]);

  const panelDisplayName = account.portalDisplayName?.trim() || account.clientDisplayName;

  return (
    <>
      {accountUnavailable ? (
        <PortalUnavailableState
          title="Account details could not be loaded"
          hint="Your sign-in is still valid. Account setup will appear once the account service responds."
        />
      ) : (
        <PortalAccountOnboarding
          initialAccount={account}
          readOnly={readOnly}
          saveActionImpl={saveActionImpl}
          completeActionImpl={completeActionImpl}
          onSuccess={handleSuccess}
        />
      )}
      {trustFailed ? (
        <PortalUnavailableState
          title="Account status could not be loaded"
          hint="Your sign-in is still valid. Status checks will appear once the account service responds."
        />
      ) : (
        <PortalAccountPanel
          displayName={panelDisplayName}
          loginEmail={account.portalLoginEmail ?? loginEmail}
          locationLabel={locationLabel}
          nicheLabels={account.primaryNicheKeys}
          productLabels={account.primaryProductTypes}
          trust={trust}
        />
      )}
    </>
  );
}
