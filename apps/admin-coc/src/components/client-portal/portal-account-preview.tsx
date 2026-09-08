"use client";

import { PortalAccountView } from "@/components/client-portal/portal-account-view";
import type { PortalAccountProfile } from "@/lib/client-portal/account-profile";
import {
  previewCompletePortalAccount,
  previewSavePortalAccount,
} from "@/lib/client-portal/portal-account-fixtures";

export function PortalAccountPreview({
  initialAccount,
}: {
  initialAccount: PortalAccountProfile;
}) {
  return (
    <PortalAccountView
      initialAccount={initialAccount}
      loginEmail={initialAccount.portalLoginEmail}
      saveActionImpl={previewSavePortalAccount}
      completeActionImpl={previewCompletePortalAccount}
    />
  );
}
