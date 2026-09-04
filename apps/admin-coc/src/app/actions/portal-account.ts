"use server";

import { cookies } from "next/headers";

import {
  completeClientAccountOnboarding,
  patchClientAccountProfile,
} from "@/lib/client-portal-api/account";
import { fetchClientTrustCenter } from "@/lib/client-portal-api/server";
import {
  customerAccountErrorCopy,
  profilePayloadFromForm,
  type PortalAccountActionState,
  type PortalAccountTrustRefreshState,
} from "@/lib/client-portal/account-profile";
import { mapClientTrustCenter } from "@/lib/client-portal/map-client-trust";
import { readTrustedPortalSession } from "@/lib/client-portal/portal-auth";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export type { PortalAccountActionState, PortalAccountTrustRefreshState };

async function sessionTenantId(cookieValue: string | undefined): Promise<string | null> {
  const session = await readTrustedPortalSession(cookieValue);
  const id = session?.clientAccountId?.trim();
  return id || null;
}

export async function savePortalAccountAction(
  _prev: PortalAccountActionState | undefined,
  formData: FormData
): Promise<PortalAccountActionState> {
  const store = await cookies();
  const clientAccountId = await sessionTenantId(store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value);
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
  const clientAccountId = await sessionTenantId(store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value);
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

export async function refreshPortalAccountTrustAction(): Promise<PortalAccountTrustRefreshState> {
  const store = await cookies();
  const clientAccountId = await sessionTenantId(store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value);
  if (!clientAccountId) {
    return { trust: null, error: "Sign in again to refresh account status." };
  }

  const result = await fetchClientTrustCenter({ clientAccountId });
  if (result.error) {
    return { trust: null, error: result.error };
  }
  return { trust: mapClientTrustCenter(result.data), error: null };
}
