"use server";

import { cookies } from "next/headers";

import {
  completeClientAccountOnboarding,
  patchClientAccountProfile,
} from "@/lib/client-portal-api/account";
import {
  customerAccountErrorCopy,
  profilePayloadFromForm,
  type PortalAccountActionState,
} from "@/lib/client-portal/account-profile";
import { getPortalSession } from "@/lib/client-portal/access-gate";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export type { PortalAccountActionState };

function sessionTenantId(cookieValue: string | undefined): string | null {
  const session = getPortalSession(cookieValue);
  const id = session?.clientAccountId?.trim();
  return id || null;
}

export async function savePortalAccountAction(
  _prev: PortalAccountActionState | undefined,
  formData: FormData
): Promise<PortalAccountActionState> {
  const store = await cookies();
  const clientAccountId = sessionTenantId(store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value);
  if (!clientAccountId) {
    return { ok: false, error: "Sign in again to update your account." };
  }

  const result = await patchClientAccountProfile({
    clientAccountId,
    body: profilePayloadFromForm(formData),
  });
  if (!result.account) {
    return { ok: false, error: customerAccountErrorCopy(result.error, result.status) };
  }
  return { ok: true, account: result.account };
}

export async function completePortalAccountAction(
  _prev: PortalAccountActionState | undefined,
  formData: FormData
): Promise<PortalAccountActionState> {
  const store = await cookies();
  const clientAccountId = sessionTenantId(store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value);
  if (!clientAccountId) {
    return { ok: false, error: "Sign in again to finish account setup." };
  }

  const result = await completeClientAccountOnboarding({
    clientAccountId,
    body: profilePayloadFromForm(formData),
  });
  if (!result.account || result.status >= 400) {
    return {
      ok: false,
      error: customerAccountErrorCopy(result.error, result.status),
      account: result.account ?? undefined,
      missingFields: result.missingFields,
    };
  }
  return { ok: true, account: result.account };
}
