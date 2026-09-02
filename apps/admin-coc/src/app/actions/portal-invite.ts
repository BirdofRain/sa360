"use server";

import { redirect } from "next/navigation";

import { postPortalInviteAccept } from "@/lib/client-portal-api/portal-context";
import {
  PORTAL_INVITE_INVALID,
  PORTAL_INVITE_SUCCESS_LOGIN_PATH,
  preparePortalInviteAccept,
} from "@/lib/client-portal/portal-invite-flow";

export async function portalInviteAcceptAction(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  const prepared = preparePortalInviteAccept(formData);
  if (!prepared.ok) {
    return { error: prepared.error };
  }

  const result = await postPortalInviteAccept(prepared.token, prepared.password);
  if (!result.ok) {
    if (result.code === "PASSWORD_INVALID") {
      return { error: result.error };
    }
    return { error: PORTAL_INVITE_INVALID };
  }

  redirect(PORTAL_INVITE_SUCCESS_LOGIN_PATH);
}
