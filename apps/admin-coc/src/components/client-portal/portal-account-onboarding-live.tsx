"use client";

import { useRouter } from "next/navigation";

import {
  completePortalAccountAction,
  savePortalAccountAction,
} from "@/app/actions/portal-account";
import type { PortalAccountProfile } from "@/lib/client-portal/account-profile";

import { PortalAccountOnboarding } from "./portal-account-onboarding";

export function PortalAccountOnboardingLive({
  initialAccount,
  readOnly = false,
}: {
  initialAccount: PortalAccountProfile;
  readOnly?: boolean;
}) {
  const router = useRouter();
  return (
    <PortalAccountOnboarding
      initialAccount={initialAccount}
      readOnly={readOnly}
      saveActionImpl={savePortalAccountAction}
      completeActionImpl={completePortalAccountAction}
      onSuccess={() => router.refresh()}
    />
  );
}
